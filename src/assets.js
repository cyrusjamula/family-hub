// Build artifact placeholder. `npm run assets` generates the deployable module
// from public/ before every validated build. Do not commit bundled user data.
export function asset(){return new Response('Run npm run build before serving the Worker.',{status:503,headers:{'cache-control':'no-store','content-type':'text/plain'}});}
