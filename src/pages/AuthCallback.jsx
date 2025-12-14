import { useEffect } from "react";
import { supabase } from "../lib/supabase";
import { useNavigate } from "react-router-dom";

export default function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    const check = async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        navigate("/chat", { replace: true });
      } else {
        navigate("/", { replace: true });
      }
    };

    check();
  }, []);

  return <div>Signing you in…</div>;
}
