import { Routes, Route } from "react-router-dom";
import Login from "./pages/Login";
import ChatLayout from "./components/ChatLayout";
import AuthCallback from "./pages/AuthCallback";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Login />} />
      <Route path="/auth" element={<AuthCallback />} />
      <Route path="/chat" element={<ChatLayout />} />
    </Routes>
  );
}
