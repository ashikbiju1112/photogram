import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

export default function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
<<<<<<< HEAD
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
=======
    const handleAuth = async () => {
      const { data } = await supabase.auth.getSession();

      if (data.session) {
        navigate("/chat", { replace: true });
      }
    };

    handleAuth();
  }, []);

  return <div>Signing you in…</div>;
>>>>>>> a92627325231b7ddb989600ea7012808cfc1123d
}
