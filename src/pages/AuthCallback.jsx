import { useEffect } from "react";
import { supabase } from "../lib/supabase";
import { useNavigate } from "react-router-dom";

export default function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        // ✅ clean URL
        window.location.hash = "";

        // ✅ go to chat
        navigate("/chat", { replace: true });
      }
    });
  }, [navigate]);

  return <div>Signing you in…</div>;
}