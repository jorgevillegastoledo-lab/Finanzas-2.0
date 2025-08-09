import { useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, TextField, Button, Typography, Stack } from "@mui/material";
import { useAuth } from "../context/AuthContext";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { setToken } = useAuth();
  const navigate = useNavigate();

  const submit = async () => {
    const form = new FormData();
    form.append("username", email); // FastAPI usa "username" para el email
    form.append("password", password);
    try {
      const { data } = await axios.post(`${API}/auth/login`, form);
      setToken(data.access_token);
      navigate("/");
    } catch {
      alert("Login inválido");
    }
  };

  return (
    <Stack alignItems="center" sx={{ mt: 8 }}>
      <Card sx={{ width: 420 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>Iniciar sesión</Typography>
          <Stack spacing={2}>
            <TextField label="Email" value={email} onChange={e=>setEmail(e.target.value)}/>
            <TextField label="Contraseña" type="password" value={password} onChange={e=>setPassword(e.target.value)}/>
            <Button variant="contained" onClick={submit}>Entrar</Button>
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
}
