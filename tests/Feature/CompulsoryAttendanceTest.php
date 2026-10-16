<?php

use App\Models\Event;
use App\Models\EventObligation;
use App\Services\CompulsoryAttendance;
use App\Services\EventSchedule;
use App\Models\UserAccount;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;

uses(RefreshDatabase::class);

function compulsoryTestAccount(string $reference, string $role, string $course = '', string $year = '', string $block = ''): UserAccount
{
    return UserAccount::create([
        'reference' => $reference,
        'name' => 'Test '.$reference,
        'email' => strtolower($reference).'@tmc.edu.ph',
        'role' => $role,
        'status' => 'Active',
        'course' => $course,
        'year' => $year,
        'block_no' => $block,
        'password' => 'password',
    ]);
}

function createCompulsoryTestEvent(array $overrides = []): Event
{
    $event = Event::create(array_merge([
        'reference' => 'EVT-COMPULSORY-TEST',
        'title' => 'Compulsory Test Event',
        'status' => 'Approved',
        'attendance_compulsory' => true,
        'attendance_requires_checkout' => true,
        'target_department' => 'CCS',
        'target_year' => '3rd Year',
        'target_block' => 'A',
    ], $overrides));
    app(EventSchedule::class)->ensureSessions($event);
    app(CompulsoryAttendance::class)->finalizeRoster($event);
    return $event->refresh();
}

test('an approved compulsory event finalizes its audience automatically', function () {
    Sanctum::actingAs(compulsoryTestAccount('USR-COMP-AUTO-ADMIN', 'Admin'));
    compulsoryTestAccount('USR-COMP-AUTO-STUDENT', 'Student', 'BS Information Technology', '3rd Year', 'A');

    $this->postJson('/api/events', [
        'reference' => 'EVT-COMPULSORY-AUTO',
        'title' => 'Automatic Roster Event',
        'status' => 'Approved',
        'attendance_compulsory' => true,
        'target_department' => 'CCS',
        'target_year' => '3rd Year',
        'target_block' => 'A',
    ])->assertCreated();

    $event = Event::where('reference', 'EVT-COMPULSORY-AUTO')->firstOrFail();
    expect($event->attendance_roster_finalized_at)->not->toBeNull()
        ->and($event->attendanceObligations()->count())->toBe(1);
});

test('approving a compulsory event snapshots matching active students without requiring registration', function () {
    Sanctum::actingAs(compulsoryTestAccount('USR-COMP-ADMIN', 'Admin'));
    $required = compulsoryTestAccount('USR-COMP-REQUIRED', 'Student', 'BS Information Technology', '3rd Year', 'A');
    compulsoryTestAccount('USR-COMP-WRONG-BLOCK', 'Student', 'BS Information Technology', '3rd Year', 'B');
    compulsoryTestAccount('USR-COMP-WRONG-COURSE', 'Student', 'BS Criminology', '3rd Year', 'A');
    compulsoryTestAccount('USR-COMP-SCANNER', 'Scanner');

    $event = createCompulsoryTestEvent();

    expect(EventObligation::where('event_id', $event->id)->count())->toBe(1)
        ->and(EventObligation::where('event_id', $event->id)->value('user_account_id'))->toBe($required->id)
        ->and($event->attendanceObligations()->first()->student_name)->toBe($required->name);
});

test('an empty compulsory roster is finalized once and does not absorb later accounts', function () {
    Sanctum::actingAs(compulsoryTestAccount('USR-COMP-EMPTY-ADMIN', 'Admin'));
    $event = createCompulsoryTestEvent(['reference' => 'EVT-COMPULSORY-EMPTY']);
    expect($event->attendance_roster_finalized_at)->not->toBeNull();

    $student = compulsoryTestAccount('USR-COMP-LATE-STUDENT', 'Student', 'BS Information Technology', '3rd Year', 'A');
    expect(app(CompulsoryAttendance::class)->finalizeRoster($event))->toBe(0)
        ->and(EventObligation::where('event_id', $event->id)->where('user_account_id', $student->id)->exists())->toBeFalse();
});

test('a required student without an event registration can check in with their account QR token', function () {
    Sanctum::actingAs(compulsoryTestAccount('USR-COMP-SCAN-ADMIN', 'Admin'));
    $student = compulsoryTestAccount('USR-COMP-SCAN-STUDENT', 'Student', 'BS Information Technology', '3rd Year', 'A');
    $event = createCompulsoryTestEvent(['reference' => 'EVT-COMPULSORY-SCAN']);
    $session = $event->attendanceSessions()->firstOrFail();

    $this->postJson('/api/checkin/'.$event->checkin_token.'/scan', [
        'qr_code' => $student->attendance_qr_token,
        'session_id' => $session->id,
        'direction' => 'in',
    ])->assertOk()
        ->assertJsonPath('student.participant', $student->name)
        ->assertJsonPath('attendance.status', 'Late');

    expect(EventObligation::where('event_id', $event->id)->first()->attendances()->first()->time_in)->not->toBeNull();
});

test('students can read only their own attendance and their QR credential is explicit', function () {
    $student = compulsoryTestAccount('USR-COMP-ME', 'Student', 'BS Information Technology', '3rd Year', 'A');
    $other = compulsoryTestAccount('USR-COMP-OTHER', 'Student', 'BS Information Technology', '3rd Year', 'A');
    $event = createCompulsoryTestEvent(['reference' => 'EVT-COMPULSORY-ME']);

    Sanctum::actingAs($student);
    $this->getJson('/api/my/attendance-qr')->assertOk()->assertJsonPath('qr_token', $student->attendance_qr_token);
    $this->getJson('/api/my/attendance')->assertOk()->assertJsonCount(1);

    expect($event->attendanceObligations()->where('user_account_id', $other->id)->exists())->toBeTrue();
});

test('fine assessment creates a proposed amount after the event and admin review is required to approve it', function () {
    $admin = compulsoryTestAccount('USR-COMP-FINE-ADMIN', 'Admin');
    Sanctum::actingAs($admin);
    compulsoryTestAccount('USR-COMP-FINE-STUDENT', 'Student', 'BS Information Technology', '3rd Year', 'A');
    $event = createCompulsoryTestEvent([
        'reference' => 'EVT-COMPULSORY-FINE',
        'status' => 'Completed',
        'event_date' => now()->subDay()->toDateString(),
        'absence_fine_amount' => 75,
        'incomplete_fine_amount' => 25,
        'attendance_correction_deadline' => now()->subHour(),
    ]);
    $event->attendanceSessions()->update(['status' => 'closed']);

    $result = app(CompulsoryAttendance::class)->assess($event, $admin->id);
    $fine = $event->attendanceObligations()->firstOrFail()->fine()->firstOrFail();

    expect($result['proposed'])->toBe(1)
        ->and($fine->amount)->toBe('75.00')
        ->and($fine->assessment_status)->toBe('proposed');

    $this->patchJson('/api/admin/fines/'.$fine->id.'/review', ['decision' => 'approve'])
        ->assertOk()
        ->assertJsonPath('fine.assessment_status', 'approved');
});
