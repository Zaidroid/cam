import { createClient } from '@supabase/supabase-js';

// Read Supabase URL and anon key from environment variables
// These should be set in a .env file at the project root (e.g., VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)
// and Netlify environment variables for deployment.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    'Supabase URL or anon key is missing. Make sure to set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file.'
  );
  // You might want to throw an error here or handle this more gracefully
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
