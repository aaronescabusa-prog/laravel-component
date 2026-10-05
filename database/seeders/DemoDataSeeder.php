<?php

namespace Database\Seeders;

use App\Models\ActivityLog;
use App\Models\Announcement;
use App\Models\Certificate;
use App\Models\Evaluation;
use App\Models\Event;
use App\Models\Registration;
use App\Models\UserAccount;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;

class DemoDataSeeder extends Seeder
{
    use WithoutModelEvents;

    /**
     * Seed the application's demo data.
     */
    public function run(): void
    {
        $this->seedUsers();
        $this->seedEvents();
        $this->seedAnnouncements();
        $this->seedRegistrations();
        $this->seedCertificates();
        $this->seedEvaluations();
        $this->seedLogs();
    }

    private function seedUsers(): void
    {
        $users = [
            ['reference' => 'USR-2210', 'name' => 'Admin User', 'email' => 'admin@tmc.edu.ph', 'role' => 'Admin', 'status' => 'Active', 'password' => Hash::make('password'), 'date' => '2026-08-01'],
            ['reference' => 'USR-2211', 'name' => 'Maria Santos', 'email' => 'maria.santos@student.tmc.edu.ph', 'role' => 'Student', 'status' => 'Active', 'course' => 'BS Information Technology', 'year' => '3', 'date' => '2026-08-05'],
            ['reference' => 'USR-2212', 'name' => 'John Dela Cruz', 'email' => 'john.delacruz@student.tmc.edu.ph', 'role' => 'Student', 'status' => 'Active', 'course' => 'BS Computer Science', 'year' => '2', 'date' => '2026-08-06'],
            ['reference' => 'USR-2213', 'name' => 'Ana Cruz', 'email' => 'ana.cruz@student.tmc.edu.ph', 'role' => 'Staff', 'status' => 'Active', 'course' => 'BS Education', 'year' => '4', 'date' => '2026-08-09'],
            ['reference' => 'USR-2214', 'name' => 'Paolo Ramos', 'email' => 'paolo.ramos@student.tmc.edu.ph', 'role' => 'Student', 'status' => 'Pending', 'course' => 'BS Information Technology', 'year' => '1', 'date' => '2026-09-10'],
        ];

        foreach ($users as $user) {
            UserAccount::updateOrCreate(['email' => $user['email']], $user);
        }
    }

    private function seedEvents(): void
    {
        $events = [
            ['reference' => 'EVE-1001', 'title' => 'Tech Innovation Summit 2026', 'category' => 'Seminar', 'organizer' => 'CCS Student Council', 'event_date' => '2026-09-18', 'start_time' => '09:00', 'venue' => 'Auditorium', 'description' => 'Annual showcase of student innovations.', 'budget' => 50000, 'capacity' => 300, 'participants' => 212, 'status' => 'Approved'],
            ['reference' => 'EVE-1002', 'title' => 'Leadership Workshop', 'category' => 'Workshop', 'organizer' => 'Student Affairs Office', 'event_date' => '2026-09-10', 'start_time' => '13:00', 'venue' => 'Room 204', 'description' => 'Hands-on leadership training for student officers.', 'budget' => 15000, 'capacity' => 60, 'participants' => 42, 'status' => 'Completed'],
            ['reference' => 'EVE-1003', 'title' => 'Freshmen Orientation 2026', 'category' => 'Orientation', 'organizer' => 'Student Affairs Office', 'event_date' => '2026-09-15', 'start_time' => '08:00', 'venue' => 'TMC Gymnasium', 'description' => 'Welcome program for incoming freshmen.', 'budget' => 80000, 'capacity' => 500, 'participants' => 480, 'status' => 'Approved'],
            ['reference' => 'EVE-1004', 'title' => 'Blood Donation Drive', 'category' => 'Outreach', 'organizer' => 'Red Cross Youth Club', 'event_date' => '2026-08-25', 'start_time' => '08:00', 'venue' => 'TMC Gymnasium', 'description' => 'Community blood letting activity.', 'budget' => 20000, 'capacity' => 200, 'participants' => 156, 'status' => 'Completed'],
            ['reference' => 'EVE-1005', 'title' => 'Research Colloquium 2026', 'category' => 'Academic', 'organizer' => 'R&D Office', 'event_date' => '2026-09-05', 'start_time' => '13:00', 'venue' => 'Auditorium', 'description' => 'Presentation of student research outputs.', 'budget' => 40000, 'capacity' => 250, 'participants' => 189, 'status' => 'Completed'],
            ['reference' => 'EVE-1006', 'title' => 'IT Congress: AI in Education', 'category' => 'Seminar', 'organizer' => 'CCS Student Council', 'event_date' => '2026-09-06', 'start_time' => '09:00', 'venue' => 'Auditorium', 'description' => 'Conference on artificial intelligence in education.', 'budget' => 35000, 'capacity' => 300, 'participants' => 212, 'status' => 'Approved'],
        ];

        foreach ($events as $event) {
            Event::updateOrCreate(['reference' => $event['reference']], $event);
        }
    }

    private function seedAnnouncements(): void
    {
        $announcements = [
            ['reference' => 'ANN-1001', 'title' => 'Mid-term Exam Schedule Released', 'message' => 'The mid-term examination schedule is now available. Please check the registrar for your assigned rooms and schedules.', 'audience' => 'All Users', 'category' => 'General', 'status' => 'Published', 'publish_date' => '2026-09-10', 'author' => 'Registrar Office'],
            ['reference' => 'ANN-1002', 'title' => 'Blood Donation Drive Sign-ups Open', 'message' => 'Sign up for the upcoming blood donation drive at the TMC Gymnasium. Walk-ins are welcome.', 'audience' => 'Students', 'category' => 'Event', 'status' => 'Published', 'publish_date' => '2026-09-08', 'author' => 'Red Cross Youth Club'],
        ];

        foreach ($announcements as $announcement) {
            Announcement::updateOrCreate(['reference' => $announcement['reference']], $announcement);
        }
    }

    private function seedRegistrations(): void
    {
        $registrations = [
            ['reference' => 'REG-3001', 'participant' => 'Maria Santos', 'email' => 'maria.santos@student.tmc.edu.ph', 'event' => 'Tech Innovation Summit 2026', 'payment' => '₱150.00', 'payment_status' => 'Paid', 'attendance' => 'Present', 'reg_date' => '2026-09-10', 'qr_code' => 'QR-9843CU'],
            ['reference' => 'REG-3002', 'participant' => 'John Dela Cruz', 'email' => 'john.delacruz@student.tmc.edu.ph', 'event' => 'Leadership Workshop', 'payment' => 'Free', 'payment_status' => 'N/A', 'attendance' => 'Not Yet Recorded', 'reg_date' => '2026-09-12', 'qr_code' => ''],
            ['reference' => 'REG-3003', 'participant' => 'Ana Cruz', 'email' => 'ana.cruz@student.tmc.edu.ph', 'event' => 'Blood Donation Drive', 'payment' => 'Free', 'payment_status' => 'N/A', 'attendance' => 'Present', 'reg_date' => '2026-08-20', 'qr_code' => 'QR-8123AX'],
            ['reference' => 'REG-3004', 'participant' => 'Paolo Ramos', 'email' => 'paolo.ramos@student.tmc.edu.ph', 'event' => 'IT Congress: AI in Education', 'payment' => '₱150.00', 'payment_status' => 'Pending', 'attendance' => 'Not Yet Recorded', 'reg_date' => '2026-09-14', 'qr_code' => ''],
        ];

        foreach ($registrations as $registration) {
            Registration::updateOrCreate(['reference' => $registration['reference']], $registration);
        }
    }

    private function seedCertificates(): void
    {
        $certificates = [
            ['reference' => 'CERT-9001', 'participant' => 'Maria Santos', 'email' => 'maria.santos@student.tmc.edu.ph', 'event' => 'Tech Innovation Summit 2026', 'status' => 'Issued', 'date_issued' => '2026-09-15', 'qr_code' => 'CERT-9001-QR'],
            ['reference' => 'CERT-9002', 'participant' => 'John Dela Cruz', 'email' => 'john.delacruz@student.tmc.edu.ph', 'event' => 'Leadership Workshop', 'status' => 'Pending', 'date_issued' => '', 'qr_code' => ''],
            ['reference' => 'CERT-9003', 'participant' => 'Ana Cruz', 'email' => 'ana.cruz@student.tmc.edu.ph', 'event' => 'Blood Donation Drive', 'status' => 'Issued', 'date_issued' => '2026-08-27', 'qr_code' => 'CERT-9003-QR'],
        ];

        foreach ($certificates as $certificate) {
            Certificate::updateOrCreate(['reference' => $certificate['reference']], $certificate);
        }
    }

    private function seedEvaluations(): void
    {
        $evaluations = [
            ['reference' => 'EVL-701', 'event' => 'IT Congress: AI in Education', 'participant' => 'Paolo Ramos', 'rating' => 5, 'comment' => 'Great speakers, learned a lot about practical AI applications in classrooms.', 'date' => '2026-09-18'],
            ['reference' => 'EVL-700', 'event' => 'IT Congress: AI in Education', 'participant' => 'Carlo Domingo', 'rating' => 4, 'comment' => 'Venue was a bit cramped but overall a solid event.', 'date' => '2026-09-18'],
            ['reference' => 'EVL-699', 'event' => 'Research Colloquium 2026', 'participant' => 'Grace Villanueva', 'rating' => 3, 'comment' => 'Registration process at the door took too long.', 'date' => '2026-09-05'],
            ['reference' => 'EVL-698', 'event' => 'Blood Donation Drive', 'participant' => 'Jon Reyes', 'rating' => 5, 'comment' => 'Very organized, staff were friendly and efficient.', 'date' => '2026-08-25'],
            ['reference' => 'EVL-697', 'event' => 'Blood Donation Drive', 'participant' => 'Ana Cruz', 'rating' => 4, 'comment' => '', 'date' => '2026-08-25'],
        ];

        foreach ($evaluations as $evaluation) {
            Evaluation::updateOrCreate(['reference' => $evaluation['reference']], $evaluation);
        }
    }

    private function seedLogs(): void
    {
        $logs = [
            ['reference' => 'LOG-10021', 'timestamp' => '2026-09-06 09:14:02', 'user' => 'Admin User', 'role' => 'Admin', 'category' => 'Login', 'action' => 'Logged in successfully', 'details' => 'IP 192.168.1.14 · Chrome on Windows'],
            ['reference' => 'LOG-10020', 'timestamp' => '2026-09-06 09:02:47', 'user' => 'Ana Cruz', 'role' => 'Staff', 'category' => 'Payment', 'action' => 'Verified payment for TMC-8840', 'details' => 'IT Congress: AI in Education — ₱150.00'],
            ['reference' => 'LOG-10019', 'timestamp' => '2026-09-06 08:55:31', 'user' => 'Admin User', 'role' => 'Admin', 'category' => 'Certificate', 'action' => 'Generated certificate CERT-9004', 'details' => 'Research Colloquium 2026 — Maria Santos'],
            ['reference' => 'LOG-10018', 'timestamp' => '2026-09-05 17:40:09', 'user' => 'Grace Villanueva', 'role' => 'Admin', 'category' => 'Event', 'action' => 'Approved event proposal', 'details' => 'IT Congress: AI in Education'],
            ['reference' => 'LOG-10017', 'timestamp' => '2026-09-05 16:12:55', 'user' => 'Liza Fernandez', 'role' => 'Organizer', 'category' => 'Event', 'action' => 'Submitted event for approval', 'details' => 'Leadership Training Workshop'],
        ];

        foreach ($logs as $log) {
            ActivityLog::updateOrCreate(['reference' => $log['reference']], $log);
        }
    }
}
