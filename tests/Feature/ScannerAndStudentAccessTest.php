<?php

use App\Models\Event;
use App\Models\Registration;
use App\Models\UserAccount;
use App\Services\EventSchedule;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;

uses(RefreshDatabase::class);

function scannerAccessAccount(string $role, string $suffix): UserAccount
{
    return UserAccount::create([
        'reference' => "USR-ACCESS-{$suffix}",
        'name' => "Access {$suffix}",
        'email' => "access-{$suffix}@tmc.test",
        'role' => $role,
        'status' => 'Active',
        'password' => 'password',
    ]);
}

function scannerAccessEvent(string $suffix, array $overrides = []): Event
{
    return Event::create(array_merge([
        'reference' => "EVE-ACCESS-{$suffix}",
        'title' => "Access Event {$suffix}",
        'category' => 'Seminar',
        'event_date' => '2026-10-20',
        'status' => 'Approved',
    ], $overrides));
}

function scannerAccessRegistration(Event $event, UserAccount $student): Registration
{
    $registration = Registration::forceCreate([
        'reference' => 'REG-ACCESS-1',
        'participant' => $student->name,
        'email' => $student->email,
        'role' => 'Student',
        'event' => $event->title,
        'event_id' => $event->id,
        'user_account_id' => $student->id,
        'qr_code' => 'PASS-ACCESS-1',
        'payment' => 'Free',
        'payment_status' => 'N/A',
        'attendance' => 'Not Yet Recorded',
        'reg_date' => '2026-10-01',
    ]);

    return $registration;
}

test('assigned scanners can record attendance only for their approved events and lose access on revocation', function () {
    $admin = scannerAccessAccount('Admin', 'ADMIN');
    $scanner = scannerAccessAccount('Scanner', 'SCAN');
    $event = scannerAccessEvent('ONE');
    $otherEvent = scannerAccessEvent('TWO');
    $student = scannerAccessAccount('Student', 'STUDENT');
    $registration = scannerAccessRegistration($event, $student);
    app(EventSchedule::class)->ensureSessions($event);
    $session = $event->attendanceSessions()->firstOrFail();

    Sanctum::actingAs($admin);
    $this->putJson("/api/events/{$event->reference}/scanners", [
        'scanner_ids' => [$scanner->id],
    ])->assertOk();

    Sanctum::actingAs($scanner);
    $this->getJson('/api/scanner/events')
        ->assertOk()
        ->assertJsonCount(1)
        ->assertJsonPath('0.reference', $event->reference)
        ->assertJsonPath('0.checkin_token', $event->checkin_token);

    $this->getJson("/api/checkin/{$event->checkin_token}")->assertOk();
    $this->postJson("/api/checkin/{$event->checkin_token}/punch", [
        'session_id' => $session->id,
        'direction' => 'in',
        'registration_ids' => [$registration->id],
        'at' => '2026-10-20 08:05:00',
    ])->assertOk();

    $this->getJson("/api/checkin/{$otherEvent->checkin_token}")->assertForbidden();

    Sanctum::actingAs($admin);
    $this->putJson("/api/events/{$event->reference}/scanners", [
        'scanner_ids' => [],
    ])->assertOk();

    Sanctum::actingAs($scanner);
    $this->getJson('/api/scanner/events')->assertOk()->assertJsonCount(0);
    $this->getJson("/api/checkin/{$event->checkin_token}")->assertForbidden();
});

test('a mobile student-pass scan is recorded and appears in the web check-in roster', function () {
    $admin = scannerAccessAccount('Admin', 'SCAN-ADMIN');
    $scanner = scannerAccessAccount('Scanner', 'MOBILE');
    $event = scannerAccessEvent('MOBILE');
    $student = scannerAccessAccount('Student', 'MOBILE-STUDENT');
    $registration = scannerAccessRegistration($event, $student);
    app(EventSchedule::class)->ensureSessions($event);
    $session = $event->attendanceSessions()->firstOrFail();

    Sanctum::actingAs($admin);
    $this->putJson("/api/events/{$event->reference}/scanners", [
        'scanner_ids' => [$scanner->id],
    ])->assertOk();

    Sanctum::actingAs($scanner);
    $scan = $this->postJson("/api/checkin/{$event->checkin_token}/scan", [
        'qr_code' => $registration->qr_code,
        'session_id' => $session->id,
        'direction' => 'in',
    ])->assertOk()
        ->assertJsonPath('registration.reference', $registration->reference)
        ->assertJsonPath('registration.participant', $student->name)
        ->assertJsonPath('attendance.status', 'Present');

    $roster = $this->getJson("/api/checkin/{$event->checkin_token}")
        ->assertOk()
        ->assertJsonPath("roster.0.sessions.{$session->id}.status", 'Present');
    expect($roster->json("roster.0.sessions.{$session->id}.time_in"))->not->toBeNull();

    $this->postJson("/api/checkin/{$event->checkin_token}/scan", [
        'qr_code' => 'PASS-NOT-REGISTERED',
        'session_id' => $session->id,
        'direction' => 'in',
    ])->assertNotFound();
});

test('students do not inherit scanner permissions and scanners cannot configure sessions', function () {
    $event = scannerAccessEvent('ROLE');
    app(EventSchedule::class)->ensureSessions($event);
    $session = $event->attendanceSessions()->firstOrFail();

    Sanctum::actingAs(scannerAccessAccount('Student', 'STUDENT'));
    $this->getJson("/api/checkin/{$event->checkin_token}")->assertForbidden();

    Sanctum::actingAs(scannerAccessAccount('Scanner', 'CONFIG'));
    $this->patchJson("/api/sessions/{$session->id}", ['time_in' => '07:30'])->assertForbidden();
    $this->getJson("/api/events/{$event->reference}/sessions")->assertForbidden();
});

test('students can self-register and read only their own event passes', function () {
    $student = scannerAccessAccount('Student', 'SELF');
    $otherStudent = scannerAccessAccount('Student', 'OTHER');
    $event = scannerAccessEvent('STUDENT');

    Sanctum::actingAs($student);
    $response = $this->postJson('/api/registrations/self', [
        'event_reference' => $event->reference,
        'participant' => 'Spoofed Identity',
        'email' => 'spoofed@example.test',
        'role' => 'Admin',
        'qr_code' => 'NOT-A-VALID-PASS',
    ])->assertCreated()
        ->assertJsonPath('participant', $student->name)
        ->assertJsonPath('email', $student->email)
        ->assertJsonPath('role', 'Student')
        ->assertJsonPath('event', $event->title)
        ->assertJsonPath('user_account_id', $student->id);

    $reference = $response->json('reference');
    expect($response->json('qr_code'))->not->toBe('NOT-A-VALID-PASS');

    $this->getJson('/api/registrations')
        ->assertOk()
        ->assertJsonCount(1, 'data')
        ->assertJsonPath('data.0.reference', $reference);

    $this->getJson("/api/registrations/{$reference}")->assertOk();

    $otherRegistration = scannerAccessRegistration(
        scannerAccessEvent('OTHER-PASS'),
        $otherStudent,
    );
    $this->getJson("/api/registrations/{$otherRegistration->reference}")->assertNotFound();

    $this->postJson('/api/registrations/self', [
        'event_reference' => $event->reference,
    ])->assertUnprocessable();
});

test('student self-registration rejects ineligible and full events', function () {
    $student = scannerAccessAccount('Student', 'LIMITED');
    $ineligibleEvent = scannerAccessEvent('INELIGIBLE', [
        'target_role' => 'Admin',
    ]);
    $fullEvent = scannerAccessEvent('FULL', [
        'capacity' => 0,
    ]);

    Sanctum::actingAs($student);
    $this->postJson('/api/registrations/self', [
        'event_reference' => $ineligibleEvent->reference,
    ])->assertUnprocessable();
    $this->postJson('/api/registrations/self', [
        'event_reference' => $fullEvent->reference,
    ])->assertUnprocessable();
});
