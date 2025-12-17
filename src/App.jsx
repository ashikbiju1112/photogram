import { Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/Login";
import ChatLayout from "./components/ChatLayout";
import AuthCallback from "./pages/AuthCallback";
import AdminPanel from "./admin/AdminPanel";
import { AuthProvider, useAuth } from "./context/AuthProvider";
import { useAdmin } from "./hooks/useAdmin";

/* 🔐 Protected route for logged-in users */
function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <div style={{ padding: 20 }}>Checking session…</div>;
  }

  if (!user) {
    return <Navigate to="/" replace />;
  }

  return children;
}

/* 👮 Admin-only route */
function AdminRoute({ children }) {
  const { isAdmin, loading } = useAdmin();

  if (loading) {
    return <div style={{ padding: 20 }}>Checking admin access…</div>;
  }

  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        {/* Public routes */}
        <Route path="/" element={<Login />} />
        <Route path="/auth" element={<AuthCallback />} />

        {/* Protected user route */}
        <Route
          path="/chat"
          element={
            <ProtectedRoute>
              <ChatLayout />
            </ProtectedRoute>
          }
        />

        {/* Admin-only route */}
        <Route
          path="/admin"
          element={
            <AdminRoute>
              <AdminPanel />
            </AdminRoute>
          }
        />
      </Routes>
    </AuthProvider>
  );
}
