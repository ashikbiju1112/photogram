import { Routes, Route } from "react-router-dom";
import Login from "./pages/Login";
import ChatLayout from "./components/ChatLayout";
import AuthCallback from "./pages/AuthCallback";
import AdminPanel from "./admin/AdminPanel";
import { useAdmin } from "./hooks/useAdmin";
//import { useAuth } from "../hooks/useAuth";




export default function App() {
  const { isAdmin, loading } = useAdmin();

if (loading) {
    return <div style={{ padding: 20 }}>Checking permissions…</div>;
  }

  return (
    <Routes>
      <Route path="/" element={<Login />} />
      <Route path="/auth" element={<AuthCallback />} />
      <Route path="/chat" element={<ChatLayout />} />
      <Route
  path="/admin"
  element={isAdmin ? <AdminPanel /> : <Navigate to="/" />}
/>

    </Routes>
  );
}
