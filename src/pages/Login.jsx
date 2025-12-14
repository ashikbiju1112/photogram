import { useEffect } from "react";
import { supabase } from "../lib/supabase";
import { useNavigate } from "react-router-dom";

export default function Login() {
  const navigate = useNavigate();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        navigate("/chat", { replace: true });
      }
    });
  }, []);

  return (
    <button
      onClick={async () => {
        await supabase.auth.signInWithOAuth({
          provider: "google",
          options: {
            redirectTo: `${window.location.origin}/#/auth`,
          },
        });
      }}
    >
      Continue with Google
    </button>
  );
}
