// Deno Edge Function: check-user-exists.ts
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
    });
  }

  const { email } = await req.json();

  if (!email || typeof email !== 'string') {
    return new Response(JSON.stringify({ error: 'Valid email is required' }), {
      status: 400,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const url = `${supabaseUrl}/auth/v1/admin/users`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'apikey': serviceRoleKey,
      'Authorization': `Bearer ${serviceRoleKey}`,
    },
  });

  const bodyText = await response.text();

  if (!response.ok) {
    return new Response(JSON.stringify({ error: bodyText }), {
      status: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
    });
  }

  let data;
  try {
    data = JSON.parse(bodyText);
  } catch (_) {
    return new Response(JSON.stringify({ error: 'Failed to parse response' }), {
      status: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
    });
  }

  // ✅ Manually check for an exact email match
  const matchingUser = data.users?.find(
    (user: any) => user.email?.toLowerCase() === email.toLowerCase()
  );

  return new Response(
    JSON.stringify({
      exists: !!matchingUser,
      ...(matchingUser ? { user: matchingUser } : {}),
    }),
    {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
    }
  );
});

