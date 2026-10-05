import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter } from "react-router-dom"
import "./index.css"
import App from "./App.jsx"
import { AuthProvider } from "./lib/auth"
import { APP_BASE } from "./lib/api"
// Loaded last on purpose: ui.css is the modern + responsive layer that
// overrides the per-page stylesheets, so it must win the cascade.
import "./ui.css"

createRoot(document.getElementById("root")).render(
    <StrictMode>
        {/* basename lets the SPA own /login, /dashboard, ... when it is served
            from a sub-directory instead of the document root. */}
        <BrowserRouter basename={APP_BASE || "/"}>
            <AuthProvider>
                <App />
            </AuthProvider>
        </BrowserRouter>
    </StrictMode>
)