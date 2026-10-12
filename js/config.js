/* Fill in both values (Supabase > Project Settings > API) to use the shared database.
   Leave them empty for demo mode: data then never leaves the browser.

   The "anon" key is meant to be public; row-level security in supabase/schema.sql is what protects the data.
   Never put the "service_role" key here. */
window.KILLER_CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: ''
};
