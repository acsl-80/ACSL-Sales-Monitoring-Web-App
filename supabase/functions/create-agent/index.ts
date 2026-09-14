import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js';

// CORS helper
function withCors(res: Response) {
  res.headers.set('Access-Control-Allow-Origin', '*');
  res.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  return res;
}

serve(async (req) => {
  console.log('➡️ Request:', req.method, req.url);

  if (req.method === 'OPTIONS') {
    return withCors(new Response('ok', { status: 200 }));
  }

  try {
    const supabase = createClient(
      Deno.env.get('BASE_URL'),
      Deno.env.get('ANON_KEY'),
      {
        global: {
          headers: {
            Authorization: req.headers.get('Authorization'),
          },
        },
      }
    );

    console.log('🔍 Validating token...');
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      console.error('❌ Authentication failed:', userError);
      return withCors(
        new Response(
          JSON.stringify({
            success: false,
            message: 'Not authenticated',
            details: userError,
          }),
          { status: 401 }
        )
      );
    }

    console.log('✅ Authenticated user ID:', user.id);

    // Get admin's profile and org ID
    const { data: adminProfile, error: profileError } = await supabase
      .from('profiles')
      .select('role, organization_id')
      .eq('id', user.id)
      .maybeSingle();

    if (profileError || !adminProfile || adminProfile.role !== 'admin') {
      console.error('❌ Role check failed:', profileError);
      return withCors(
        new Response(
          JSON.stringify({
            success: false,
            message: 'Only admins can create agents',
          }),
          { status: 403 }
        )
      );
    }

    if (!adminProfile.organization_id) {
      return withCors(
        new Response(
          JSON.stringify({
            success: false,
            message: 'Admin does not belong to any organization',
          }),
          { status: 400 }
        )
      );
    }

    console.log('✅ User is admin of organization:', adminProfile.organization_id);

    const body = await req.json();
    console.log('📦 Request body:', body);

    const { email, password, full_name, phone } = body;

    if (![email, password, full_name, phone].every(Boolean)) {
      console.error('🚫 Invalid input');
      return withCors(
        new Response(
          JSON.stringify({
            success: false,
            message: 'Missing required fields: email, password, full_name, phone',
          }),
          { status: 400 }
        )
      );
    }

    const adminClient = createClient(
      Deno.env.get('BASE_URL'),
      Deno.env.get('BASE_SERVICE_ROLE_KEY')
    );

    console.log('👷 Creating agent user...');
    const { data: newUser, error: createError } =
      await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });

    if (createError || !newUser?.user?.id) {
      console.error('❌ User creation failed:', createError);
      return withCors(
        new Response(
          JSON.stringify({
            success: false,
            message: createError?.message || 'Failed to create user',
            code: createError?.code || 'unknown_error',
          }),
          { status: createError?.status || 400 }
        )
      );
    }

    console.log('✅ Created user ID:', newUser.user.id);

    const { error: insertError } = await adminClient.from('profiles').insert({
      id: newUser.user.id,
      email,
      full_name,
      phone,
      role: 'agent',
      has_changed_password: false,
      organization_id: adminProfile.organization_id, // 👈 NEW LINE
    });

    if (insertError) {
      console.error('❌ Profile insert failed:', insertError);
      return withCors(
        new Response(
          JSON.stringify({
            success: false,
            message: insertError?.message || 'Failed to insert profile',
          }),
          { status: 500 }
        )
      );
    }

    console.log('🎉 Agent created successfully');
    return withCors(
      new Response(
        JSON.stringify({
          success: true,
          message: 'Agent created successfully',
        }),
        { status: 200 }
      )
    );
  } catch (err) {
    console.error('🔥 Unexpected error:', err);
    return withCors(
      new Response(
        JSON.stringify({
          success: false,
          message: 'Unexpected error',
          details: err,
        }),
        { status: 500 }
      )
    );
  }
});
