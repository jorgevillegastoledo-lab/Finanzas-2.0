import { AppBar, Toolbar, Typography, Button, Box, Container } from "@mui/material";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Layout({ children }) {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const salir = () => { logout(); navigate("/login"); };

  return (
    <Box sx={{ minHeight:"100vh", bgcolor:"#f6f7fb" }}>
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6" sx={{ flexGrow:1 }}>Finanzas 2.0</Typography>
          <Button color="inherit" component={Link} to="/">Dashboard</Button>
          <Button color="inherit" component={Link} to="/gastos">Gastos</Button>
          <Button color="inherit" component={Link} to="/prestamos">Préstamos</Button>
          <Button color="inherit" component={Link} to="/tarjetas">Tarjetas</Button>
          <Button color="inherit" onClick={salir}>Salir</Button>
        </Toolbar>
      </AppBar>
      <Container maxWidth="lg" sx={{ mt:3 }}>{children}</Container>
    </Box>
  );
}
