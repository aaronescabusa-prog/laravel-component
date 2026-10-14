import { Routes, Route, Navigate } from "react-router-dom";
import RequireAuth from "./components/RequireAuth";
import Login from "./Login";
import Register from "./Register";
import Dashboard from "./Dashboard";
import Users from "./Users";
import Events from "./Events";
import Announcements from "./Announcements";
import Registrations from "./Registrations";
import CheckIn from "./CheckIn";
import Settings from "./Settings";
import Reports from "./Reports";
import Certificates from "./Certificates";
import Evaluations from "./Evaluations";
import ActivityLogs from "./ActivityLogs";
import ScannerPermissions from "./ScannerPermissions";
import AttendanceReports from "./AttendanceReports";
import StudentPortal from "./StudentPortal";
import { useAuth } from "./lib/auth";

function DashboardRoute() {
    const { user } = useAuth();
    return user?.role === "Student" ? <StudentPortal view="home" /> : <Dashboard />;
}

function EventsRoute() {
    const { user } = useAuth();
    return user?.role === "Student" ? <StudentPortal view="events" /> : <Events />;
}


function App() {
    return (
        <Routes>
            <Route path="/" element={<Navigate to="/login" />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
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
            <Route path="/attendance-reports" element={<RequireAuth><AttendanceReports /></RequireAuth>} />
            <Route path="/announcements" element={<RequireAuth><Announcements /></RequireAuth>} />
            <Route path="/registrations" element={<RequireAuth><Registrations /></RequireAuth>} />
  {/* /check-in/:token is what a printed event QR resolves to. The token only
      names the event; the page still requires an authenticated staff session. */}
  <Route path="/check-in" element={<RequireAuth><CheckIn /></RequireAuth>} />
  <Route path="/check-in/:token" element={<RequireAuth><CheckIn /></RequireAuth>} />
            <Route path="/settings" element={<RequireAuth><Settings /></RequireAuth>} />
            <Route path="/reports" element={<RequireAuth><Reports /></RequireAuth>} />
            <Route path="/certificates" element={<RequireAuth><Certificates /></RequireAuth>} />
            <Route path="/evaluations" element={<RequireAuth><Evaluations /></RequireAuth>} />
            <Route path="/activity-logs" element={<RequireAuth><ActivityLogs /></RequireAuth>} />
            <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
    );
}

export default App;
