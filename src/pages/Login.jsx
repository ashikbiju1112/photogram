import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

export default function Login() {
  const navigate = useNavigate();

  useEffect(() => {
    // 🔐 If already logged in, go to chat
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        navigate("/chat", { replace: true });
      }
    });
  }, []);

  const loginWithGoogle = async () => {
    await supabase.auth.signInWithOAuth({
<<<<<<< HEAD
  provider: "google",
  options: {
    redirectTo: window.location.origin + "/#/auth",
  },
});

=======
      provider: "google",
      options: {
        redirectTo: window.location.origin + "/#/auth",
      },
    });
>>>>>>> a92627325231b7ddb989600ea7012808cfc1123d
  };

  return (
    <div className="login">
      <button onClick={loginWithGoogle}>
        Continue with Google
      </button>
    </div>
  );
}
