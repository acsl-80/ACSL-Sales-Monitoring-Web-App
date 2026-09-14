import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js';

// UUID generator (clean, without prefix)
function generateUUID() {
  return crypto.randomUUID();
}

// Simple log wrapper
function log(...args) {
  console.log('🧠', ...args);
}

serve(async (req) => {
  log('➡️ Incoming request:', req.method, req.url);

  // Handle preflight (CORS)
  if (req.method === 'OPTIONS') {
    log('🛑 Preflight request (OPTIONS)');
    return new Response('ok', {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      }
    });
  }

  // Create Supabase client
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL'),
    Deno.env.get('SUPABASE_ANON_KEY'),
    {
      global: {
        headers: {
          Authorization: req.headers.get('Authorization') ?? ''
        }
      }
    }
  );

  try {
    const contentType = req.headers.get('content-type') || '';
    log('🧾 Content-Type:', contentType);

    if (!contentType.includes('multipart/form-data')) {
      log('❌ Invalid content type');
      return new Response(JSON.stringify({
        success: false,
        message: 'Unsupported content type'
      }), { status: 400 });
    }

    // Authenticate user
    const { data: userData, error: authError } = await supabase.auth.getUser();
    if (authError || !userData?.user) {
      log('❌ Unauthorized:', authError);
      return new Response(JSON.stringify({
        success: false,
        message: 'Unauthorized'
      }), { status: 401 });
    }

    const userId = userData.user.id;
    log('🔐 Authenticated user:', userId);

    // Parse form data
    const formData = await req.formData();
    const file = formData.get('file');
    const imageType = formData.get('type')?.toString() || 'unknown';
    log('📦 Image type:', imageType);
    log('📁 Received file:', file?.name, file?.type, file?.size);

    if (!file || !(file instanceof File)) {
      log('❌ No valid file received');
      return new Response(JSON.stringify({
        success: false,
        message: 'No image uploaded'
      }), { status: 400 });
    }

    const ext = file.name.split('.').pop();
    const publicId = generateUUID(); // ✅ Clean UUID
    const uploadPath = `${imageType}/${publicId}.${ext}`;
    log('📂 Upload path:', uploadPath);

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage.from('images').upload(uploadPath, file.stream(), {
      contentType: file.type,
      upsert: false
    });

    if (uploadError) {
      log('❌ Upload error:', uploadError);
      return new Response(JSON.stringify({
        success: false,
        message: 'Upload failed',
        error: uploadError
      }), { status: 500 });
    }

    // Get public URL
    const { data: urlData } = supabase.storage.from('images').getPublicUrl(uploadPath);
    const fullPublicURL = urlData.publicUrl;
    log('✅ Image uploaded. Public URL:', fullPublicURL);

    // Save metadata to `uploads` table
    const { data: uploadMeta, error: insertError } = await supabase
      .from('uploads')
      .insert([
        {
          public_id: publicId,
          url: fullPublicURL,
          type: imageType,
          created_by: userId
        }
      ])
      .select()
      .maybeSingle();

    if (insertError || !uploadMeta) {
      log('❌ Upload metadata insert failed:', insertError);
      return new Response(JSON.stringify({
        success: false,
        message: 'Upload saved but metadata insert failed',
        error: insertError
      }), { status: 500 });
    }

    return new Response(JSON.stringify({
      success: true,
      message: 'Image uploaded and metadata saved',
      upload: uploadMeta
    }), {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (error) {
    log('🔥 Unexpected error:', error);
    return new Response(JSON.stringify({
      success: false,
      message: 'Unexpected error',
      error: error.message
    }), { status: 500 });
  }
});
