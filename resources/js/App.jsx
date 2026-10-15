import { lazy, Suspense } from "react";
import { Routes, Route, Navigate, useParams } from "react-router-dom";
import RequireAuth from "./components/RequireAuth";
const Login = lazy(() => import("./Login"));
const Register = lazy(() => import("./Register"));
const Dashboard = lazy(() => import("./Dashboard"));
const Users = lazy(() => import("./Users"));
const Events = lazy(() => import("./Events"));
const Announcements = lazy(() => import("./Announcements"));
const Registrations = lazy(() => import("./Registrations"));
const Attendance = lazy(() => import("./Attendance"));
const Settings = lazy(() => import("./Settings"));
const Reports = lazy(() => import("./Reports"));
const Certificates = lazy(() => import("./Certificates"));
const Evaluations = lazy(() => import("./Evaluations"));
const ActivityLogs = lazy(() => import("./ActivityLogs"));
const ScannerPermissions = lazy(() => import("./ScannerPermissions"));
const StudentPortal = lazy(() => import("./StudentPortal"));
const PasswordReset = lazy(() => import("./PasswordReset"));
import { useAuth } from "./lib/auth";

function DashboardRoute() {
    const { user } = useAuth();
    return user?.role === "Student" ? <StudentPortal view="home" /> : <Dashboard />;
}

function EventsRoute() {
    const { user } = useAuth();
    return user?.role === "Student" ? <StudentPortal view="events" /> : <Events />;
}

function LegacyCheckInRedirect() {
    const { token } = useParams();
    return <Navigate to={token ? `/attendance/check-in/${encodeURIComponent(token)}` : "/attendance"} replace />;
}


function App() {
    return (
        <Suspense fallback={<div className="route-loading" role="status">Loading EventEase…</div>}>
        <Routes>
            <Route path="/" element={<Navigate to="/login" />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/forgot-password" element={<PasswordReset />} />
            <Route path="/reset-password/:token" element={<PasswordReset />} />
            <Route
                path="/dashboard"
                element={(
                    <RequireAuth>
                        <DashboardRoute />
                    </RequireAuth>
                )}
            />
            <Route path="/users" element={<RequireAuth><Users /></RequireAuth>} />
            <Route path="/events" element={<RequireAuth><EventsRoute /></RequireAuth>} />
            <Route path="/my-events" element={<RequireAuth><StudentPortal view="my-events" /></RequireAuth>} />
            <Route path="/profile" element={<RequireAuth><StudentPortal view="profile" /></RequireAuth>} />
            <Route path="/scanner-permissions" element={<RequireAuth><ScannerPermissions /></RequireAuth>} />
            <Route path="/attendance" element={<RequireAuth><Attendance /></RequireAuth>} />
            <Route path="/attendance/check-in/:token" element={<RequireAuth><Attendance /></RequireAuth>} />
            <Route path="/attendance-reports" element={<Navigate to="/attendance" replace />} />
            <Route path="/announcements" element={<RequireAuth><Announcements /></RequireAuth>} />
            <Route path="/registrations" element={<RequireAuth><Registrations /></RequireAuth>} />
            <Route path="/check-in" element={<LegacyCheckInRedirect />} />
            <Route path="/check-in/:token" element={<LegacyCheckInRedirect />} />
            <Route path="/settings" element={<RequireAuth><Settings /></RequireAuth>} />
            <Route path="/reports" element={<RequireAuth><Reports /></RequireAuth>} />
            <Route path="/certificates" element={<RequireAuth><Certificates /></RequireAuth>} />
            <Route path="/evaluations" element={<RequireAuth><Evaluations /></RequireAuth>} />
            <Route path="/activity-logs" element={<RequireAuth><ActivityLogs /></RequireAuth>} />
            <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
        </Suspense>
    );
}

export default App;
