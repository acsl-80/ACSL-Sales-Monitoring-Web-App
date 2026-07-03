import { serve } from "https://deno.land/std@0.131.0/http/server.ts";

console.log("Hello 2!");

serve(async () => {
  const data = {
    message: `Hello from Bharat!`,
  };

  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
  });
});
