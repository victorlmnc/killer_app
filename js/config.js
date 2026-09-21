/* Renseigne ces deux valeurs (Supabase > Project Settings > API) pour brancher la base partagée.
   Laisse-les vides pour rester en mode démo : les données ne quittent alors pas le navigateur.

   La clé « anon » est faite pour être publique : ce sont les règles RLS de supabase/schema.sql
   qui protègent les données. Ne mets JAMAIS la clé « service_role » ici. */
window.KILLER_CONFIG = {
  supabaseUrl: 'https://kgmbnhzujzybtvahqpnx.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtnbWJuaHp1anp5YnR2YWhxcG54Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk5NDMyOTUsImV4cCI6MjEwNTUxOTI5NX0.zZ7lCiBTIVWj6MegcU2Lt1l17Ez6XzFJIAJU5OVBYW0'
};
