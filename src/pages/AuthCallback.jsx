import { useEffect } from "react";
import { supabase } from "../lib/supabase";
import { useNavigate } from "react-router-dom";

export default function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    const run = async () => {
      const { error } = await supabase.auth.getSession();

      if (error) {
        console.error("Auth error:", error.message);
      }

      // ✅ ALWAYS clean the hash
      window.location.hash = "";

      // ✅ Go to chat
      navigate("/chat", { replace: true });
    };

    run();
  }, [navigate]);

  return <div style={{ padding: 20 }}>Signing you in…</div>;
}
