<?php

use App\Models\Event;
use App\Models\Registration;
use App\Models\UserAccount;
use App\Services\EventAudience;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

beforeEach(function () {
    // Only named accounts exist, so nothing inherited from the seed can turn
    // up in a roster and make a count look wrong.
    UserAccount::query()->forceDelete();

    $this->student = audienceAccount('IT Student', 'student.it@student.tmc.edu.ph', 'BS Information Technology');
    $this->otherStudent = audienceAccount('CS Student', 'student.cs@student.tmc.edu.ph', 'BS Computer Science');
    $this->pendingStudent = audienceAccount('Pending IT Student', 'pending.it@student.tmc.edu.ph', 'BS Information Technology', 'Pending');
    $this->formerStaff = audienceAccount('IT Student 2', 'former.staff@student.tmc.edu.ph', 'BS Information Technology');
});

function audienceAccount(string $name, string $email, string $course, string $status = 'Active', string $role = 'Student'): UserAccount
{
    return UserAccount::create([
        'reference' => 'USR-'.strtoupper(bin2hex(random_bytes(3))),
        'name' => $name,
        'email' => $email,
        'course' => $course,
        'status' => $status,
        'role' => $role,
        'password' => 'secret1234',
    ]);
}

function audienceEvent(array $overrides = []): Event
{
    return Event::create(array_merge([
        'reference' => 'EVE-'.strtoupper(bin2hex(random_bytes(3))),
        'title' => 'Course Event',
        'category' => 'Seminar',
        'status' => 'Approved',
    ], $overrides));
}

it('enrols the active accounts in the targeted course', function () {
    $event = audienceEvent(['target_course' => 'BS Information Technology']);

    app(EventAudience::class)->sync($event);

    $emails = Registration::pluck('email')->sort()->values()->all();

    expect($emails)->toContain($this->student->email, $this->formerStaff->email)
        ->not->toContain($this->otherStudent->email, $this->pendingStudent->email);
});

it('enrols matching student accounts in the targeted course', function () {
    $event = audienceEvent(['target_course' => 'BS Information Technology']);

    $result = app(EventAudience::class)->sync($event);

    $student = Registration::where('email', $this->formerStaff->email)->first();

    expect($result['matched'])->toBe(2)
        ->and($student->role)->toBe('Student');
});

it('leaves a public event with nobody enrolled', function () {
    $event = audienceEvent();

    $result = app(EventAudience::class)->sync($event);

    expect($result['matched'])->toBe(0)
        ->and($result['added'])->toBeEmpty()
        ->and(Registration::count())->toBe(0);
});

it('attaches each enrolment to the event so it reaches the check-in roster', function () {
    $event = audienceEvent(['target_course' => 'BS Information Technology']);

    app(EventAudience::class)->sync($event);

    $registration = Registration::where('email', $this->student->email)->first();

    expect($registration->event_id)->toBe($event->id)
        ->and($registration->event)->toBe($event->title)
        ->and($registration->participant)->toBe($this->student->name)
        ->and($registration->attendance)->toBe('Not Yet Recorded')
        ->and($registration->payment_status)->toBe('N/A');
});

it('gives every enrolment a distinct reference continuing the REG sequence', function () {
    Registration::create([
        'reference' => 'REG-3001',
        'participant' => 'Existing',
        'email' => 'existing@student.tmc.edu.ph',
        'event' => 'Older Event',
    ]);

    $event = audienceEvent(['target_course' => 'BS Information Technology']);

    app(EventAudience::class)->sync($event);

    $references = Registration::orderBy('reference')->pluck('reference')->all();

    expect($references)->toContain('REG-3002', 'REG-3003')
        ->and($references)->toHaveCount(3);
});

it('does not enrol the same person twice', function () {
    $event = audienceEvent(['target_course' => 'BS Information Technology']);

    app(EventAudience::class)->sync($event);
    $second = app(EventAudience::class)->sync($event);

    expect(Registration::count())->toBe(2)
        ->and($second['matched'])->toBe(2)
        ->and($second['added'])->toBeEmpty();
});

it('recognises a registration made before the event foreign key existed', function () {
    $event = audienceEvent(['target_course' => 'BS Information Technology']);

    // No event_id, and the email typed in a different case: the only thing that
    // links this row to the event is the title, so a match on id alone would
    // enrol this student a second time.
    Registration::create([
        'reference' => 'REG-3001',
        'participant' => $this->student->name,
        'email' => strtoupper($this->student->email),
        'event' => $event->title,
        'event_id' => null,
    ]);

    $result = app(EventAudience::class)->sync($event);

    expect($result['added'])->toHaveCount(1)
        ->and(Registration::count())->toBe(2)
        ->and(Registration::where('email', strtoupper($this->student->email))->count())->toBe(1)
        ->and(Registration::where('email', $this->student->email)->count())->toBe(0);
});

it('respects a registration a registrar soft deleted', function () {
    $event = audienceEvent(['target_course' => 'BS Information Technology']);

    Registration::create([
        'reference' => 'REG-3001',
        'participant' => $this->student->name,
        'email' => $this->student->email,
        'event' => $event->title,
    ])->delete();

    app(EventAudience::class)->sync($event);

    expect(Registration::count())->toBe(1)
        ->and(Registration::where('email', $this->student->email)->first())->toBeNull();
});

it('adds the new audience when the course changes and keeps the old one', function () {
    $event = audienceEvent(['target_course' => 'BS Information Technology']);
    app(EventAudience::class)->sync($event);

    $event->update(['target_course' => 'BS Computer Science']);
    $result = app(EventAudience::class)->sync($event->refresh());

    expect($result['added'])->toHaveCount(1)
        ->and(Registration::count())->toBe(3)
        ->and(Registration::where('email', $this->student->email)->exists())->toBeTrue()
        ->and(Registration::where('email', $this->otherStudent->email)->exists())->toBeTrue();
});

it('picks up an account that was cleared after the event was saved', function () {
    $event = audienceEvent(['target_course' => 'BS Information Technology']);
    app(EventAudience::class)->sync($event);
    expect(Registration::count())->toBe(2);

    $this->pendingStudent->update(['status' => 'Active']);
    $result = app(EventAudience::class)->sync($event);

    expect($result['added'])->toHaveCount(1)
        ->and(Registration::count())->toBe(3);
});

it('does not create registrations when a targeted event is saved', function () {
    $admin = audienceAccount('Admin', 'admin.it@tmc.edu.ph', 'BS Criminology', 'Active', 'Admin');
    $this->actingAs($admin, 'sanctum');

    $response = $this->postJson('/api/events', [
        'reference' => 'EVE-9001',
        'title' => 'IT Forum',
        'category' => 'Seminar',
        'status' => 'Approved',
        'target_course' => 'BS Information Technology',
    ]);

    $response->assertCreated()
        ->assertJsonPath('target_course', 'BS Information Technology')
        ->assertJsonMissingPath('audience');

    expect(Registration::count())->toBe(0);
});

it('reports an empty audience for a public event', function () {
    $admin = audienceAccount('Admin', 'admin2.it@tmc.edu.ph', 'BS Information Technology', 'Active', 'Admin');
    $this->actingAs($admin, 'sanctum');

    $response = $this->postJson('/api/events', [
        'reference' => 'EVE-9002',
        'title' => 'Open Seminar',
        'category' => 'Seminar',
        'status' => 'Approved',
    ]);

    $response->assertCreated()
        ->assertJsonMissingPath('audience');

    expect(Registration::count())->toBe(0);
});

it('does not create registrations when an existing event is retargeted', function () {
    $event = audienceEvent();
    $admin = audienceAccount('Admin', 'admin3.it@tmc.edu.ph', 'BS Criminology', 'Active', 'Admin');
    $this->actingAs($admin, 'sanctum');

    $response = $this->patchJson("/api/events/{$event->reference}", [
        'target_course' => 'BS Information Technology',
    ]);

    $response->assertOk()
        ->assertJsonPath('target_course', 'BS Information Technology')
        ->assertJsonMissingPath('audience');

    expect(Registration::count())->toBe(0);
});
