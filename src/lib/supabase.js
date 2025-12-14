import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  "https://vhmlkyjsevidwkymmvtu.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZobWxreWpzZXZpZHdreW1tdnR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU2MDAxMTksImV4cCI6MjA4MTE3NjExOX0.i20MJx8gH80XQuAArjDIPOARjU31Ui55pHDryY5EMgQ"
);
