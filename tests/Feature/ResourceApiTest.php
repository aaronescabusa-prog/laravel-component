<?php

use App\Models\ActivityLog;
use App\Models\Event;
use App\Models\Setting;
use App\Models\UserAccount;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;

uses(RefreshDatabase::class);

function makeAdmin(): UserAccount
{
    return UserAccount::create([
        'reference' => 'USR-ADMIN',
        'name' => 'Admin User',
        'email' => 'admin@tmc.edu.ph',
        'role' => 'Admin',
        'status' => 'Active',
        'password' => 'password',
    ]);
}

function makeStudent(): UserAccount
{
    return UserAccount::create([
        'reference' => 'USR-STUDENT',
        'name' => 'Student One',
        'email' => 'student@tmc.edu.ph',
        'role' => 'Student',
        'status' => 'Active',
        'password' => 'password',
    ]);
}

function makeRestrictedStudent(): UserAccount
{
    return UserAccount::create([
        'reference' => 'USR-STAFF',
        'name' => 'Staff One',
        'email' => 'staff@tmc.edu.ph',
        'role' => 'Student',
        'status' => 'Active',
        'password' => 'password',
    ]);
}

/** One importable row, shaped as the CSV importer sends it. */
function importRow(array $overrides = []): array
{
    return array_merge([
        'line' => 2,
        'reference' => 'USR-9001',
        'name' => 'Imported Person',
        'email' => 'imported@tmc.edu.ph',
        'role' => 'Student',
        'status' => 'Active',
        'course' => 'BS Information Technology',
        'block_no' => 'A1',
        'year' => '2',
        'date' => '2026-10-03',
        'password' => 'USR-9001',
    ], $overrides);
}

/* --------------------------------------------------------- bulk CSV import */

test('an administrator can bulk import accounts', function () {
    Sanctum::actingAs(makeAdmin());

    $response = $this->postJson('/api/user-accounts/import', [
        'rows' => [
            importRow(),
            importRow([
                'line' => 3,
                'reference' => 'USR-9002',
                'email' => 'second@tmc.edu.ph',
                'password' => 'USR-9002',
            ]),
        ],
    ])->assertOk();

    expect($response->json('imported'))->toHaveCount(2)
        ->and($response->json('skipped'))->toBeEmpty()
        ->and(UserAccount::where('reference', 'USR-9001')->exists())->toBeTrue()
        ->and(UserAccount::where('reference', 'USR-9002')->exists())->toBeTrue();
});

test('bulk import is refused for a student account', function () {
    Sanctum::actingAs(makeRestrictedStudent());

    $this->postJson('/api/user-accounts/import', ['rows' => [importRow()]])
        ->assertForbidden();

    expect(UserAccount::where('reference', 'USR-9001')->exists())->toBeFalse();
});

test('legacy role permission rows cannot grant account access', function () {
    // Legacy settings cannot restore write access to retired account roles.
    Setting::set('roles_permissions', [
        ['role' => 'Staff', 'manage_users' => true],
    ]);

    Sanctum::actingAs(makeRestrictedStudent());

    // The ordinary single create is admin-only under Step 1 (requireAdmin),
    // even when the settings screen widens Staff write access.
    $this->postJson('/api/user-accounts', [
        'reference' => 'USR-ONE',
        'name' => 'Single Add',
        'email' => 'single@tmc.edu.ph',
        'role' => 'Student',
        'status' => 'Active',
        'password' => 'USR-ONE-1',
    ])->assertForbidden();

    // The bulk path is not.
    $this->postJson('/api/user-accounts/import', ['rows' => [importRow()]])
        ->assertForbidden();

    expect(UserAccount::where('reference', 'USR-9001')->exists())->toBeFalse();
});

test('a rejected row is skipped without costing the rest of the file', function () {
    Sanctum::actingAs(makeAdmin());

    $response = $this->postJson('/api/user-accounts/import', [
        'rows' => [
            importRow(),
            // Password under the 8-character minimum.
            importRow(['line' => 3, 'reference' => 'USR-9002', 'email' => 'short@tmc.edu.ph', 'password' => 'short']),
            // Not an email address.
            importRow(['line' => 4, 'reference' => 'USR-9003', 'email' => 'not-an-email', 'password' => 'USR-9003']),
            importRow(['line' => 5, 'reference' => 'USR-9004', 'email' => 'fourth@tmc.edu.ph', 'password' => 'USR-9004']),
        ],
    ])->assertOk();

    $body = $response->json();

    expect($body['imported'])->toHaveCount(2)
        ->and($body['skipped'])->toHaveCount(2);

    // The line numbers are the caller's, so the dialog can point at the
    // offending line of the user's own file.
    expect(collect($body['skipped'])->pluck('line')->all())->toEqual([3, 4])
        ->and($body['skipped'][0]['reason'])->toContain('password');

    expect(UserAccount::where('reference', 'USR-9001')->exists())->toBeTrue()
        ->and(UserAccount::where('reference', 'USR-9002')->exists())->toBeFalse()
        ->and(UserAccount::where('reference', 'USR-9003')->exists())->toBeFalse()
        ->and(UserAccount::where('reference', 'USR-9004')->exists())->toBeTrue();
});

test('a duplicate inside one import is skipped rather than overwriting', function () {
    Sanctum::actingAs(makeAdmin());

    $response = $this->postJson('/api/user-accounts/import', [
        'rows' => [
            importRow(),
            // Same email, different reference: the second must not overwrite the
            // first, and must not be revived over it either.
            importRow(['line' => 3, 'reference' => 'USR-9002']),
        ],
    ])->assertOk();

    expect($response->json('imported'))->toHaveCount(1)
        ->and($response->json('skipped'))->toHaveCount(1)
        ->and($response->json('skipped.0.reason'))->toContain('email')
        ->and(UserAccount::where('reference', 'USR-9001')->count())->toBe(1)
        ->and(UserAccount::where('reference', 'USR-9002')->exists())->toBeFalse();
});

test('an import revives a soft-deleted namesake instead of colliding', function () {
    Sanctum::actingAs(makeAdmin());

    UserAccount::create([
        'reference' => 'USR-9001',
        'name' => 'Old Name',
        'email' => 'imported@tmc.edu.ph',
        'role' => 'Student',
        'status' => 'Active',
        'password' => 'password',
    ])->delete();

    $this->postJson('/api/user-accounts/import', ['rows' => [importRow()]])->assertOk();

    $account = UserAccount::where('reference', 'USR-9001')->first();

    expect($account)->not->toBeNull()
        ->and($account->trashed())->toBeFalse()
        ->and($account->name)->toBe('Imported Person')
        ->and(UserAccount::withTrashed()->where('reference', 'USR-9001')->count())->toBe(1);
});

test('bulk import refuses an empty or oversized file outright', function () {
    Sanctum::actingAs(makeAdmin());

    $this->postJson('/api/user-accounts/import', ['rows' => []])
        ->assertStatus(422);

    $this->postJson('/api/user-accounts/import', [
        'rows' => array_fill(0, 501, importRow()),
    ])->assertStatus(422);
});

test('re-creating a deleted event revives it instead of colliding', function () {
    Sanctum::actingAs(makeAdmin());

    Event::create(['reference' => 'EVE-9001', 'title' => 'Deleted Event', 'category' => 'Workshop', 'status' => 'Draft'])->delete();

    $response = $this->postJson('/api/events', [
        'reference' => 'EVE-9001', 'title' => 'Restored Event', 'category' => 'Workshop', 'status' => 'Draft',
    ])->assertCreated();

    expect(Event::withTrashed()->where('reference', 'EVE-9001')->count())->toBe(1)
        ->and($response->json('title'))->toBe('Restored Event');
});

test('re-creating a deleted registration revives it instead of colliding', function () {
    Sanctum::actingAs(makeAdmin());

    \App\Models\Registration::forceCreate([
        'reference' => 'REG-9001', 'participant' => 'Old Name', 'email' => 'old@tmc.test',
        'event' => 'IT Congress', 'payment_status' => 'Paid', 'attendance' => 'Present',
        'reg_date' => '2026-10-01',
    ])->delete();

    $response = $this->postJson('/api/registrations', [
        'reference' => 'REG-9001', 'participant' => 'New Name', 'email' => 'new@tmc.test',
        'event' => 'IT Congress', 'payment_status' => 'Paid', 'attendance' => 'Present',
    ])->assertOk();

    expect(\App\Models\Registration::withTrashed()->where('reference', 'REG-9001')->count())->toBe(1)
        ->and($response->json('participant'))->toBe('New Name');
});

function seedActivityLog(string $reference, string $action): ActivityLog
{
    return ActivityLog::create([
        'reference' => $reference,
        'timestamp' => '2026-09-05 17:40:09',
        'user' => 'Admin User',
        'role' => 'Admin',
        'category' => 'Login',
        'action' => $action,
    ]);
}

test('admin can list, create, show, update and delete events', function () {
    Sanctum::actingAs(makeAdmin());

    $this->getJson('/api/events')->assertOk();

    $created = $this->postJson('/api/events', [
        'reference' => 'EVE-1001',
        'title' => 'Tech Innovation Summit 2026',
        'category' => 'Seminar',
        'organizer' => 'CCS Student Council',
        'event_date' => '2026-09-18',
        'status' => 'Approved',
    ])->assertStatus(201)->json();

    $this->getJson('/api/events/EVE-1001')->assertOk();

    $this->putJson('/api/events/EVE-1001', ['title' => 'Tech Summit 2026 Updated'])
        ->assertOk()
        ->assertJson(['title' => 'Tech Summit 2026 Updated']);

    $this->deleteJson('/api/events/EVE-1001')->assertStatus(204);

    expect(Event::count())->toBe(0);
});

test('create requires a unique reference and title', function () {
    Sanctum::actingAs(makeAdmin());

    $this->postJson('/api/events', ['reference' => 'EVE-1001', 'status' => 'Draft'])
        ->assertStatus(422)
        ->assertJsonValidationErrors('title');

    $this->postJson('/api/events', [
        'reference' => 'EVE-1001',
        'title' => 'Duplicate ref test',
        'status' => 'Draft',
    ])->assertStatus(201);

    $this->postJson('/api/events', [
        'reference' => 'EVE-1001',
        'title' => 'Duplicate ref test 2',
        'status' => 'Draft',
    ])->assertStatus(422);
});

test('events persist the certificate toggle and default to enabled', function () {
    Sanctum::actingAs(makeAdmin());

    $this->postJson('/api/events', [
        'reference' => 'EVE-CERT-1',
        'title' => 'No Cert Event',
        'category' => 'Seminar',
        'status' => 'Draft',
        'has_certificate' => false,
    ])->assertStatus(201)->assertJson(['has_certificate' => false]);

    $this->postJson('/api/events', [
        'reference' => 'EVE-CERT-2',
        'title' => 'Default Cert Event',
        'category' => 'Seminar',
        'status' => 'Draft',
    ])->assertStatus(201);

    expect(Event::where('reference', 'EVE-CERT-2')->first()->has_certificate)->toBeTrue();

    $this->putJson('/api/events/EVE-CERT-1', ['has_certificate' => true])
        ->assertOk()
        ->assertJson(['has_certificate' => true]);
});

test('events persist the penalty type and penalty amount', function () {
    Sanctum::actingAs(makeAdmin());

    $this->postJson('/api/events', [
        'reference' => 'EVE-PEN-1',
        'title' => 'Penalty Event',
        'category' => 'Seminar',
        'status' => 'Draft',
        'penalty_type' => 'Late Fee',
        'penalty_amount' => 500,
    ])->assertStatus(201)
        ->assertJson(['penalty_type' => 'Late Fee', 'penalty_amount' => 500]);

    $this->postJson('/api/events', [
        'reference' => 'EVE-PEN-2',
        'title' => 'No Penalty Event',
        'category' => 'Seminar',
        'status' => 'Draft',
        'penalty_type' => 'No Certificate',
    ])->assertStatus(201)
        ->assertJson(['penalty_type' => 'No Certificate', 'penalty_amount' => null]);

    $event = Event::where('reference', 'EVE-PEN-1')->first();
    expect($event->penalty_type)->toBe('Late Fee')
        ->and($event->penalty_amount)->toBe(500);

    $this->putJson('/api/events/EVE-PEN-1', ['penalty_type' => 'No Show Fee', 'penalty_amount' => 750])
        ->assertOk()
        ->assertJson(['penalty_type' => 'No Show Fee', 'penalty_amount' => 750]);

    $event->refresh();
    expect($event->penalty_type)->toBe('No Show Fee')
        ->and($event->penalty_amount)->toBe(750);
});

test('an event audience is limited to a real course or left public', function () {
    Sanctum::actingAs(makeAdmin());

    UserAccount::create([
        'reference' => 'USR-COURSE-1',
        'name' => 'Course One',
        'email' => 'course1@tmc.edu.ph',
        'role' => 'Student',
        'course' => 'BS Information Technology',
        'password' => 'secret-password',
    ]);

    // No course chosen: the event is public.
    $this->postJson('/api/events', [
        'reference' => 'EVE-AUD-PUBLIC',
        'title' => 'Open To Everyone',
        'category' => 'Seminar',
        'status' => 'Draft',
    ])->assertStatus(201)->assertJson(['target_course' => null]);

    // A real course is accepted and read back.
    $this->postJson('/api/events', [
        'reference' => 'EVE-AUD-COURSE',
        'title' => 'BSIT Only',
        'category' => 'Seminar',
        'status' => 'Draft',
        'target_course' => 'BS Information Technology',
    ])->assertStatus(201)
        ->assertJson(['target_course' => 'BS Information Technology']);

    // A course nobody is enrolled in is rejected.
    $this->postJson('/api/events', [
        'reference' => 'EVE-AUD-BOGUS',
        'title' => 'Imaginary Course',
        'category' => 'Seminar',
        'status' => 'Draft',
        'target_course' => 'BS Astrology',
    ])->assertStatus(422)->assertJsonValidationErrors('target_course');

    $this->putJson('/api/events/EVE-AUD-COURSE', ['target_course' => null])
        ->assertOk()
        ->assertJson(['target_course' => null]);
});

test('the course picker offers the full catalogue, not just enrolled courses', function () {
    Sanctum::actingAs(makeAdmin());

    // BS Criminology has no students at all and must still be offered: a
    // course exists whether or not anyone is enrolled in it yet.
    $this->getJson('/api/events/courses')
        ->assertOk()
        ->assertJsonPath('courses', [
            'BS Information Technology',
            'BS Criminology',
            'BS Office Administration',
            'BS Education Major in English',
            'Bachelor of Elementary Education',
            'BA Political Science',
            'BA Communications',
        ]);
});

test('an event duration is derived from its start and end schedule', function () {
    Sanctum::actingAs(makeAdmin());

    // Same day, both times: hours.
    $this->postJson('/api/events', [
        'reference' => 'EVE-DUR-HRS',
        'title' => 'Half Day Workshop',
        'category' => 'Workshop',
        'status' => 'Draft',
        'event_date' => '2026-11-02',
        'start_time' => '09:00',
        'end_date' => '2026-11-02',
        'end_time' => '13:00',
    ])->assertStatus(201)
        ->assertJson(['duration_value' => 4, 'duration_unit' => 'Hours']);

    // Spanning days, inclusive of the end date.
    $this->postJson('/api/events', [
        'reference' => 'EVE-DUR-DAYS',
        'title' => 'Two Day Summit',
        'category' => 'Seminar',
        'status' => 'Draft',
        'event_date' => '2026-11-02',
        'start_time' => '08:00',
        'end_date' => '2026-11-03',
        'end_time' => '17:00',
    ])->assertStatus(201)
        ->assertJson(['duration_value' => 2, 'duration_unit' => 'Days']);

    // No times at all is an all-day event: one whole day.
    $this->postJson('/api/events', [
        'reference' => 'EVE-DUR-ALLDAY',
        'title' => 'Foundations Day',
        'category' => 'Workshop',
        'status' => 'Draft',
        'event_date' => '2026-11-05',
        'end_date' => '2026-11-05',
    ])->assertStatus(201)
        ->assertJson(['duration_value' => 1, 'duration_unit' => 'Days']);

    // No end date yet: nothing to derive.
    $this->postJson('/api/events', [
        'reference' => 'EVE-DUR-OPEN',
        'title' => 'Open Ended Event',
        'category' => 'Seminar',
        'status' => 'Draft',
        'event_date' => '2026-11-06',
    ])->assertStatus(201)
        ->assertJson(['duration_value' => null, 'duration_unit' => null]);

    // Moving the end recalculates it.
    $this->putJson('/api/events/EVE-DUR-DAYS', ['end_date' => '2026-11-05'])
        ->assertOk()
        ->assertJson(['duration_value' => 4, 'duration_unit' => 'Days']);

    // Clearing the end clears the duration.
    $this->putJson('/api/events/EVE-DUR-HRS', ['end_date' => null])
        ->assertOk()
        ->assertJson(['duration_value' => null]);
});

test('the duration cannot contradict the submitted schedule', function () {
    Sanctum::actingAs(makeAdmin());

    // duration_value/duration_unit are calculated, so a client that posts them
    // alongside a schedule cannot force a value the range does not support.
    $this->postJson('/api/events', [
        'reference' => 'EVE-DUR-SPOOF',
        'title' => 'Spoofed Duration',
        'category' => 'Seminar',
        'status' => 'Draft',
        'event_date' => '2026-11-02',
        'start_time' => '09:00',
        'end_date' => '2026-11-02',
        'end_time' => '11:00',
        'duration_value' => 99,
        'duration_unit' => 'Days',
    ])->assertStatus(201)
        ->assertJson(['duration_value' => 2, 'duration_unit' => 'Hours']);
});

test('an event cannot end before it starts', function () {
    Sanctum::actingAs(makeAdmin());

    $this->postJson('/api/events', [
        'reference' => 'EVE-BACKWARDS',
        'title' => 'Ends Before It Starts',
        'category' => 'Seminar',
        'status' => 'Draft',
        'event_date' => '2026-11-10',
        'end_date' => '2026-11-08',
    ])->assertStatus(422)->assertJsonValidationErrors('end_date');

    // The same rule applies to a partial update that only moves the start.
    $this->postJson('/api/events', [
        'reference' => 'EVE-ORDERED',
        'title' => 'Ordered Event',
        'category' => 'Seminar',
        'status' => 'Draft',
        'event_date' => '2026-11-08',
        'end_date' => '2026-11-10',
    ])->assertStatus(201);

    $this->putJson('/api/events/EVE-ORDERED', ['event_date' => '2026-11-12'])
        ->assertStatus(422)
        ->assertJsonValidationErrors('end_date');
});

test('an event that ends after midnight counts the extra hours', function () {
    $event = Event::make([
        'event_date' => '2026-11-02',
        'start_time' => '22:00',
        'end_date' => '2026-11-02',
        'end_time' => '02:00',
    ]);

    // 22:00 to 02:00 is four hours once the wrap past midnight is accounted for.
    expect($event->deriveDuration())->toBe([4, 'Hours']);
});

test('event duration reads back as a human label', function () {
    $label = fn (?int $value, string $unit) => Event::make([
        'duration_value' => $value,
        'duration_unit' => $unit,
    ])->durationLabel();

    expect($label(8, 'Hours'))->toBe('8 hours')
        ->and($label(1, 'Hours'))->toBe('1 hour')
        ->and($label(3, 'Days'))->toBe('3 days')
        ->and($label(1, 'Days'))->toBe('1 day')
        ->and($label(0, 'Hours'))->toBeNull()
        ->and($label(null, 'Hours'))->toBeNull();
});

test('announcements keep the All Users audience on update', function () {
    Sanctum::actingAs(makeAdmin());

    $this->postJson('/api/announcements', [
        'reference' => 'ANN-900',
        'title' => 'Welcome',
        'message' => 'Hello everyone',
        'audience' => 'All Users',
        'category' => 'General',
        'status' => 'Draft',
    ])->assertStatus(201);

    $this->putJson('/api/announcements/ANN-900', ['title' => 'Welcome updated'])
        ->assertOk()
        ->assertJson(['audience' => 'All Users', 'title' => 'Welcome updated']);
});

test('search and status filters narrow the listing', function () {
    Sanctum::actingAs(makeAdmin());

    Event::create(['reference' => 'EVE-10', 'title' => 'Leadership Workshop', 'status' => 'Draft']);
    Event::create(['reference' => 'EVE-11', 'title' => 'Blood Donation Drive', 'status' => 'Approved']);

    $this->getJson('/api/events?search=Workshop')->assertJsonCount(1, 'data');
    $this->getJson('/api/events?status=Approved')->assertJsonCount(1, 'data');
});

test('students can read events but cannot write', function () {
    Event::create(['reference' => 'EVE-10', 'title' => 'Leadership Workshop', 'status' => 'Draft']);
    Event::create(['reference' => 'EVE-11', 'title' => 'Open Workshop', 'status' => 'Approved']);

    Sanctum::actingAs(makeStudent());

    $this->getJson('/api/events')
        ->assertOk()
        ->assertJsonCount(1, 'data')
        ->assertJsonPath('data.0.reference', 'EVE-11');

    $this->postJson('/api/events', [
        'reference' => 'EVE-20',
        'title' => 'Blocked',
        'category' => 'Academic',
        'status' => 'Draft',
    ])->assertStatus(403);
});

test('activity log references continue past the highest existing number', function () {
    Sanctum::actingAs(makeAdmin());

    // Seeded rows are not stored in numeric order, so the newest row is not
    // necessarily the highest one: the sequence has to be read as a maximum.
    seedActivityLog('LOG-10021', 'Seeded newest');
    seedActivityLog('LOG-10017', 'Seeded oldest');

    $this->postJson('/api/activity-logs', ['category' => 'Test', 'action' => 'Created event EVE-1'])
        ->assertStatus(201)
        ->assertJsonPath('reference', 'LOG-10022');

    $this->postJson('/api/activity-logs', ['category' => 'Test', 'action' => 'Created event EVE-2'])
        ->assertStatus(201)
        ->assertJsonPath('reference', 'LOG-10023');
});

test('activity log references never reuse a trashed entry', function () {
    Sanctum::actingAs(makeAdmin());

    seedActivityLog('LOG-10018', 'Trashed entry')->delete();

    $this->postJson('/api/activity-logs', ['category' => 'Test', 'action' => 'Logged in successfully'])
        ->assertStatus(201)
        ->assertJsonPath('reference', 'LOG-10019');
});

test('a caller supplied duplicate activity log reference is rejected', function () {
    Sanctum::actingAs(makeAdmin());

    seedActivityLog('LOG-10018', 'Existing');

    $this->postJson('/api/activity-logs', [
        'reference' => 'LOG-10018',
        'category' => 'Test',
        'action' => 'Duplicate reference',
    ])->assertStatus(422);
});
