// This file is automatically generated. Do not edit it directly.
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

const SUPABASE_URL = "https://jrmwivphspbxmacqrava.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpybXdpdnBoc3BieG1hY3FyYXZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTEzNzYzOTEsImV4cCI6MjA2Njk1MjM5MX0.8_XUV2gd9mVJkMCvBwgWwqWXQjlH_1YcaWD0SxvQrZI";

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
  }
});