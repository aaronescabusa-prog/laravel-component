import AppShell from "./components/AppShell";
import CheckIn from "./CheckIn";

function Attendance() {
    return (
        <AppShell
            title="Attendance"
            subtitle="Check participants in, review every session, and export a filtered roster."
            prefix="regs-"
        >
            <CheckIn embedded />
        </AppShell>
    );
}

export default Attendance;
