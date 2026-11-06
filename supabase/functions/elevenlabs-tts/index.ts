// Older clients may still call this route. Never read or forward the request body.
Deno.serve(() => new Response(null, { status: 410 }));
