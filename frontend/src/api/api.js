// frontend/src/api/api.js
import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://127.0.0.1:8000",
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  console.log("[api] token:", token);
  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error?.response?.status === 401) {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      window.location.href = "/login";
    }
    return Promise.reject(error);
  }
);

export default api;

/* ======= Helpers Maestros ======= */
export const ConceptosAPI = {
  list: (activos = "true") => api.get(`/conceptos`, { params: { activos } }),
  create: (payload) => api.post(`/conceptos`, payload),
  update: (id, payload) => api.patch(`/conceptos/${id}`, payload),
  setActivo: (id, activo) => api.patch(`/conceptos/${id}/activo`, { activo }),
};

export const BancosAPI = {
  list: (activos = "true") => api.get(`/bancos`, { params: { activos } }),
  create: (payload) => api.post(`/bancos`, payload),
  update: (id, payload) => api.patch(`/bancos/${id}`, payload),
  setActivo: (id, activo) => api.patch(`/bancos/${id}/activo`, { activo }),
};


