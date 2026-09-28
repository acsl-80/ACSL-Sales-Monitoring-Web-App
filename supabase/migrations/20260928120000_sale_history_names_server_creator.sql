-- Sale history names the creator of a sale a server function inserts (2026-09-28).
--
-- create_sales_history takes the actor from the signed-in user, then from app.current_user_id, and
-- records nothing when it has neither. A sale inserted by a server function has neither, so its
-- "created" row would be lost. For an insert it now falls back to the row's created_by, which every
-- inserting function sets from the caller it has verified. Updates and deletes are unchanged.
--
-- The rest of the function is exactly as defined in 00000000000000_baseline_schema.sql (never
-- redefined since).
--
-- Undo: re-run create_sales_history from 00000000000000_baseline_schema.sql.
--
-- Proof after applying (expect true):
--   select position('NEW.created_by' in pg_get_functiondef('public.create_sales_history'::regproc)) > 0;

CREATE OR REPLACE FUNCTION public.create_sales_history()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    action_type VARCHAR(50);
    action_description TEXT;
    field_changes JSONB := '{}'::jsonb;
    change_details TEXT[];
    user_context JSONB;
    user_id UUID;
BEGIN
    user_id := auth.uid();
    
    IF user_id IS NULL THEN
        user_id := current_setting('app.current_user_id', true)::UUID;
    END IF;
    
    -- A sale inserted by a server function carries no signed-in user. Its creator is the
    -- row's own created_by, which the function sets from the caller it has verified.
    IF user_id IS NULL AND TG_OP = 'INSERT' THEN
        user_id := NEW.created_by;
    END IF;

    IF user_id IS NULL THEN
        RETURN COALESCE(NEW, OLD);
    END IF;

    IF TG_OP = 'INSERT' THEN
        action_type := 'created';
        action_description := 'Sale created with transaction ID: ' || NEW.transaction_id;
        
        -- Store initial values (exclude large binary fields like signature)
        field_changes := jsonb_build_object(
            'new_values', row_to_json(NEW)::jsonb - 'signature',
            'initial_creation', true
        );
        
    ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.status != NEW.status THEN
            CASE NEW.status
                WHEN 'completed' THEN
                    action_type := 'completed';
                    action_description := 'Sale marked as completed';
                WHEN 'assigned' THEN
                    action_type := 'assigned';
                    action_description := 'Sale assigned to agent';
                WHEN 'cancelled' THEN
                    action_type := 'cancelled';
                    action_description := 'Sale cancelled';
                ELSE
                    action_type := 'updated';
                    action_description := 'Sale status changed from ' || OLD.status || ' to ' || NEW.status;
            END CASE;
        ELSE
            action_type := 'updated';
            action_description := 'Sale details updated';
        END IF;
        
        SELECT jsonb_object_agg(field_name, changes)
        INTO field_changes
        FROM (
            SELECT 
                field_name,
                jsonb_build_object(
                    'old_value', old_value,
                    'new_value', new_value
                ) as changes
            FROM (
                SELECT 'transaction_id' as field_name, to_jsonb(OLD.transaction_id) as old_value, to_jsonb(NEW.transaction_id) as new_value
                WHERE OLD.transaction_id IS DISTINCT FROM NEW.transaction_id
                UNION ALL
                SELECT 'amount', to_jsonb(OLD.amount), to_jsonb(NEW.amount)
                WHERE OLD.amount IS DISTINCT FROM NEW.amount
                UNION ALL
                SELECT 'status', to_jsonb(OLD.status), to_jsonb(NEW.status)
                WHERE OLD.status IS DISTINCT FROM NEW.status
                UNION ALL
                SELECT 'contact_person', to_jsonb(OLD.contact_person), to_jsonb(NEW.contact_person)
                WHERE OLD.contact_person IS DISTINCT FROM NEW.contact_person
                UNION ALL
                SELECT 'end_user_name', to_jsonb(OLD.end_user_name), to_jsonb(NEW.end_user_name)
                WHERE OLD.end_user_name IS DISTINCT FROM NEW.end_user_name
                UNION ALL
                SELECT 'stove_serial_no', to_jsonb(OLD.stove_serial_no), to_jsonb(NEW.stove_serial_no)
                WHERE OLD.stove_serial_no IS DISTINCT FROM NEW.stove_serial_no
                UNION ALL
                SELECT 'assigned_to', to_jsonb(OLD.assigned_to), to_jsonb(NEW.assigned_to)
                WHERE OLD.assigned_to IS DISTINCT FROM NEW.assigned_to
                UNION ALL
                SELECT 'location', to_jsonb(OLD.location), to_jsonb(NEW.location)
                WHERE OLD.location IS DISTINCT FROM NEW.location
                UNION ALL
                SELECT 'notes', to_jsonb(OLD.notes), to_jsonb(NEW.notes)
                WHERE OLD.notes IS DISTINCT FROM NEW.notes
            ) field_comparisons
            WHERE field_name IS NOT NULL
        ) changes_summary;
        
        IF field_changes = '{}'::jsonb THEN
            RETURN NEW;
        END IF;
        
    ELSIF TG_OP = 'DELETE' THEN
        action_type := 'deleted';
        action_description := 'Sale deleted: ' || OLD.transaction_id;
        field_changes := jsonb_build_object(
            'deleted_values', row_to_json(OLD)::jsonb - 'signature'
        );
    END IF;

    SELECT jsonb_build_object(
        'user_agent', current_setting('request.headers', true)::json->>'user-agent',
        'ip_address', current_setting('request.headers', true)::json->>'x-forwarded-for'
    ) INTO user_context;

    INSERT INTO sales_history (
        sale_id,
        action_type,
        action_description,
        field_changes,
        performed_by,
        performed_at,
        ip_address,
        user_agent
    ) VALUES (
        COALESCE(NEW.id, OLD.id),
        action_type,
        action_description,
        field_changes,
        user_id,
        NOW(),
        (user_context->>'ip_address')::INET,
        user_context->>'user_agent'
    );

    RETURN COALESCE(NEW, OLD);
EXCEPTION
    WHEN OTHERS THEN
        RAISE WARNING 'Failed to create sales history: %', SQLERRM;
        RETURN COALESCE(NEW, OLD);
END;
$function$;
