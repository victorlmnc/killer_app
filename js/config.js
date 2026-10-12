/* Fill in both values (Supabase > Project Settings > API) to use the shared database.
   Leave them empty for demo mode: data then never leaves the browser.

   The "anon" key is meant to be public; row-level security in supabase/schema.sql is what protects the data.
   Never put the "service_role" key here. */
window.KILLER_CONFIG = {
  supabaseUrl: 'https://kgmbnhzujzybtvahqpnx.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtnbWJuaHp1anp5YnR2YWhxcG54Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk5NDMyOTUsImV4cCI6MjEwNTUxOTI5NX0.zZ7lCiBTIVWj6MegcU2Lt1l17Ez6XzFJIAJU5OVBYW0'
};
