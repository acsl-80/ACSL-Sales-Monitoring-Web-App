// File: create-agent-user.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.5';

// Admin client using Service Role key
const supabase = createClient(
  Deno.env.get('SUPABASE_URL'),
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
);

Deno.serve(async (req) => {
  console.log('🧠 ➡️ Received request:', req.method, req.url);

  // 🌍 Handle CORS preflight
  if (req.method === 'OPTIONS') {
    console.log('🧠 🔄 Handling CORS preflight');
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
    });
  }

  try {
    // 🧪 Get admin token from Authorization header
    const authHeader = req.headers.get('Authorization') || '';
    const jwt = authHeader.replace('Bearer ', '');
    console.log('🧠 🔐 Extracted JWT:', jwt ? '[PROVIDED]' : '[MISSING]');

    const { data: currentUser, error: userError } = await supabase.auth.getUser(jwt);
    if (userError || !currentUser?.user) {
      console.error('❌ Unauthorized access:', userError?.message);
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json',
        },
      });
    }

    const adminId = currentUser.user.id;
    console.log('✅ Authenticated Admin ID:', adminId);

    // 🔍 Fetch admin profile to get organization_id
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role, organization_id')
      .eq('id', adminId)
      .maybeSingle();

    if (profileError || !profile || profile.role !== 'admin') {
      console.error('❌ Access denied - not admin or missing profile:', profileError?.message);
      return new Response(JSON.stringify({ error: 'Only admins can create agents' }), {
        status: 403,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json',
        },
      });
    }

    const adminOrgId = profile.organization_id;
    console.log('🏢 Admin belongs to organization:', adminOrgId);

    // 📦 Parse request body
    const { email, password, full_name } = await req.json();
    console.log('📥 Request data:', { email, full_name });

    if (!email || !password || !full_name) {
      console.warn('⚠️ Missing required fields');
      return new Response(JSON.stringify({ error: 'Missing fields' }), {
        status: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json',
        },
      });
    }

    // 🛠️ Create agent user with inherited organization_id
    console.log('⚙️ Creating agent user...');
    const { data: createdUser, error: createError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name,
        role: 'agent',
        organization_id: adminOrgId, // 🔗 Agent inherits org from admin
      },
    });

    if (createError) {
      console.error('❌ Failed to create user:', createError.message);
      return new Response(JSON.stringify({ error: createError.message }), {
        status: 500,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json',
        },
      });
    }

    console.log('✅ Agent user created:', createdUser.user?.id);

    // 🎉 Done
    return new Response(
      JSON.stringify({
        success: true,
        message: 'Agent created successfully',
        user_id: createdUser.user?.id,
      }),
      {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error) {
    console.error('🔥 Unexpected error occurred:', error);
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
    });
  }
});
