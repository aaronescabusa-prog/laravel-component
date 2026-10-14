<?php

use App\Models\Event;
use App\Models\Registration;
use App\Models\UserAccount;
use App\Services\EventSchedule;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;

uses(RefreshDatabase::class);

function attendanceReportTestAccount(string $role, string $suffix): UserAccount
{
    return UserAccount::create([
        'reference' => 'USR-ATT-RPT-'.$suffix,
        'name' => ucfirst(strtolower($role)).' Report User',
        'email' => strtolower($role).'-report-'.$suffix.'@tmc.edu.ph',
        'role' => $role,
        'status' => 'Active',
        'password' => 'password',
    ]);
}

test('admin attendance report reflects a student pass scan', function () {
    $event = Event::create([
        'reference' => 'EVE-ATT-RPT-1',
        'title' => 'TMC Leadership Seminar',
        'status' => 'Approved',
        'event_date' => '2026-10-14',
        'venue' => 'Main Hall',
    ]);
    $registration = Registration::forceCreate([
        'reference' => 'REG-ATT-RPT-1',
        'participant' => 'Student One',
        'email' => 'student-one@tmc.edu.ph',
        'role' => 'Student',
        'event' => $event->title,
        'event_id' => $event->id,
        'payment' => 'Free',
        'payment_status' => 'N/A',
        'attendance' => 'Not Yet Recorded',
        'reg_date' => '2026-10-14',
        'qr_code' => 'PASS-ATT-RPT-1',
    ]);

    app(EventSchedule::class)->ensureSessions($event);
    $session = $event->attendanceSessions()->firstOrFail();
    Sanctum::actingAs(attendanceReportTestAccount('Admin', 'ADMIN'));

    $this->postJson("/api/checkin/{$event->checkin_token}/scan", [
        'qr_code' => $registration->qr_code,
        'session_id' => $session->id,
        'direction' => 'in',
    ])->assertOk();

    $this->getJson("/api/events/{$event->reference}/attendance")
        ->assertOk()
        ->assertJsonPath('counts.registered', 1)
        ->assertJsonPath('roster.0.reference', 'REG-ATT-RPT-1')
        ->assertJsonPath("roster.0.sessions.{$session->id}.status", 'Late');
});

test('staff can read attendance reports under the reports role policy', function () {
    $event = Event::create([
        'reference' => 'EVE-ATT-RPT-2',
        'title' => 'Department Seminar',
        'status' => 'Approved',
        'event_date' => '2026-10-14',
    ]);
    Sanctum::actingAs(attendanceReportTestAccount('Staff', 'STAFF'));

    $this->getJson("/api/events/{$event->reference}/attendance")
        ->assertOk()
        ->assertJsonPath('event.reference', $event->reference);
});
