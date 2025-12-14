import { supabase } from "../lib/supabase";

export default function Login() {
  const loginWithGoogle = async () => {
    await supabase.auth.signInWithOAuth({
  provider: "google",
  options: {
    redirectTo: "https://photogram-live.vercel.app/#/chat",
  },
});

  };

  return (
    <div style={{
      height: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "#f0f2f5"
    }}>
      <div style={{
        width: 360,
        padding: 30,
        borderRadius: 14,
        background: "#fff",
        boxShadow: "0 10px 30px rgba(0,0,0,.15)",
        textAlign: "center"
      }}>
        <h2 style={{ marginBottom: 20 }}>Photogram</h2>
        <button
          onClick={loginWithGoogle}
          style={{
            width: "100%",
            padding: 12,
            borderRadius: 8,
            border: "none",
            background: "#25D366",
            color: "#fff",
            fontSize: 16,
            cursor: "pointer"
          }}
        >
          Continue with Google
        </button>
      </div>
    </div>
  );
}
