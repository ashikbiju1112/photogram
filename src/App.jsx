import { Routes, Route } from "react-router-dom";
import ChatLayout from "./ChatLayout";
import AuthCallback from "./pages/AuthCallback";

function App() {
  return (
    <Routes>
      <Route path="/" element={<Login />} />
      <Route path="/auth" element={<AuthCallback />} />
      <Route path="/chat" element={<ChatLayout />} />
    </Routes>
  );
}

export default App;
