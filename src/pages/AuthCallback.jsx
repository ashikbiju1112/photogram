import { useEffect } from "react";
import { supabase } from "../lib/supabase";
import { useNavigate } from "react-router-dom";

export default function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        navigate("/chat", { replace: true });
      } else {
        navigate("/", { replace: true });
      }
    });
  }, []);

  return <div>Signing you in…</div>;
}
