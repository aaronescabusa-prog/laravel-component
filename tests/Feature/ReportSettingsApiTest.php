<?php

use App\Models\Event;
use App\Models\Registration;
use App\Models\UserAccount;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;

uses(RefreshDatabase::class);

function seedEvent(string $reference, array $overrides = []): Event
{
    return Event::create(array_merge([
        'reference' => $reference,
        'title' => $reference.' event',
        'category' => 'Academic',
        'organizer' => 'R&D Office',
        'event_date' => '2026-09-05',
        'budget' => 10000,
        'capacity' => 100,
        'participants' => 0,
        'status' => 'Approved',
    ], $overrides));
}

/**
 * A registration attached to the event its title names.
 *
 * The link is resolved here the same way RegistrationController::resolveEventId
 * does, so a report grouped by event_id sees these rows. Assertions about the
 * reported `event` label still read the title column, which is what the
 * response returns.
 */
function seedRegistration(string $reference, string $event, array $overrides = []): Registration
{
    $registration = new Registration;
    $registration->forceFill(array_merge([
        'reference' => $reference,
        'participant' => 'Maria Santos',
        'email' => 'maria@tmc.edu.ph',
        'event' => $event,
        'payment' => '₱150.00',
        'payment_status' => 'Paid',
        'attendance' => 'Present',
        'reg_date' => '2026-09-03',
    ], $overrides));

    // event_id is absent from $fillable by design, so it cannot be mass-assigned
    // even in a test.
    $registration->event_id = Event::where('title', $event)->value('id');
    $registration->save();

    return $registration;
}

test('reports aggregate event, registration and financial data', function () {
    Sanctum::actingAs(UserAccount::create([
        'reference' => 'USR-ADMIN',
        'name' => 'Admin',
        'email' => 'admin-reports@tmc.edu.ph',
        'role' => 'Admin',
        'status' => 'Active',
        'password' => 'password',
    ]));

    seedEvent('EVE-1', ['title' => 'IT Congress', 'event_date' => '2026-09-10', 'budget' => 5000, 'capacity' => 100]);
    seedRegistration('REG-1', 'IT Congress', ['payment' => '₱150.00', 'payment_status' => 'Paid', 'attendance' => 'Present']);
    seedRegistration('REG-2', 'IT Congress', ['payment' => '₱150.00', 'payment_status' => 'Paid', 'attendance' => 'Absent']);
    seedRegistration('REG-3', 'IT Congress', ['payment' => '₱150.00', 'payment_status' => 'Pending', 'attendance' => 'Not Yet Recorded']);

    $response = $this->getJson('/api/reports')->assertOk()->json();

    expect($response['summary']['events'])->toBe(1);
    expect($response['registrations'][0])->toMatchArray([
        'event' => 'IT Congress',
        'registered' => 3,
        'paid' => 2,
        'pending' => 1,
        'capacity' => 100,
        'fill_rate' => 3,
    ]);
    expect($response['attendance'][0])->toMatchArray([
        'event' => 'IT Congress',
        'registered' => 3,
        'present' => 1,
        'rate' => 33,
    ]);
    expect($response['financial'][0])->toMatchArray([
        'event' => 'IT Congress',
        'income' => 300,
        'expenses' => 5000,
        'net' => -4700,
    ]);
});

test('an event with no capacity reports no fill rate', function () {
    Sanctum::actingAs(UserAccount::create([
        'reference' => 'USR-ADMIN',
        'name' => 'Admin',
        'email' => 'admin-uncapped@tmc.edu.ph',
        'role' => 'Admin',
        'status' => 'Active',
        'password' => 'password',
    ]));

    // The toggle turned off sends no capacity at all, which must not be
    // reported as a 0% fill rate - that would read as "nobody registered".
    seedEvent('EVE-UNCAPPED', [
        'title' => 'Uncapped Event',
        'event_date' => '2026-09-10',
        'capacity' => null,
    ]);
    seedRegistration('REG-1', 'Uncapped Event', ['payment_status' => 'Paid']);

    $row = $this->getJson('/api/reports')->assertOk()->json('registrations.0');

    expect($row['capacity'])->toBeNull()
        ->and($row['registered'])->toBe(1)
        ->and($row['fill_rate'])->toBeNull();
});

test('reports respect the date range filter', function () {
    Sanctum::actingAs(UserAccount::create([
        'reference' => 'USR-ADMIN',
        'name' => 'Admin',
        'email' => 'admin-reports2@tmc.edu.ph',
        'role' => 'Admin',
        'status' => 'Active',
        'password' => 'password',
    ]));

    seedEvent('EVE-1', ['title' => 'Old Event', 'event_date' => '2026-01-15']);
    seedEvent('EVE-2', ['title' => 'New Event', 'event_date' => '2026-09-15']);

    $this->getJson('/api/reports?from=2026-09-01&to=2026-09-30')
        ->assertJsonPath('summary.events', 1)
        ->assertJsonPath('events.0.title', 'New Event');
});

test('the summary counts only the events inside the requested range', function () {
    Sanctum::actingAs(UserAccount::create([
        'reference' => 'USR-ADMIN',
        'name' => 'Admin',
        'email' => 'admin-reports3@tmc.edu.ph',
        'role' => 'Admin',
        'status' => 'Active',
        'password' => 'password',
    ]));

    seedEvent('EVE-IN', ['title' => 'In Range', 'event_date' => '2026-09-15', 'status' => 'Approved']);
    seedEvent('EVE-OUT', ['title' => 'Out Of Range', 'event_date' => '2026-01-15', 'status' => 'Approved']);

    seedRegistration('REG-IN', 'In Range', ['payment_status' => 'Paid']);
    seedRegistration('REG-OUT', 'Out Of Range', ['payment_status' => 'Paid']);

    // Every figure beside the range must be narrowed with it, not merely the
    // event list: a report that says "1 event" and "2 registrations" is worse
    // than one that says nothing about totals.
    $this->getJson('/api/reports?from=2026-09-01&to=2026-09-30')
        ->assertOk()
        ->assertJsonPath('summary.events', 1)
        ->assertJsonPath('summary.events_active', 1)
        ->assertJsonPath('summary.registrations', 1)
        ->assertJsonPath('summary.registrations_paid', 1);
});

test('two events sharing a title are reported separately', function () {
    Sanctum::actingAs(UserAccount::create([
        'reference' => 'USR-ADMIN',
        'name' => 'Admin',
        'email' => 'admin-reports4@tmc.edu.ph',
        'role' => 'Admin',
        'status' => 'Active',
        'password' => 'password',
    ]));

    // Same name, different events, different audiences. Grouping on the title
    // would add their registrations together and report one event.
    seedEvent('EVE-A', ['title' => 'Career Fair', 'event_date' => '2026-09-10', 'budget' => 1000]);
    seedEvent('EVE-B', ['title' => 'Career Fair', 'event_date' => '2026-09-11', 'budget' => 2000]);

    seedRegistration('REG-A1', 'Career Fair', ['payment' => '₱100.00', 'payment_status' => 'Paid']);
    seedRegistration('REG-A2', 'Career Fair', ['payment' => '₱100.00', 'payment_status' => 'Paid']);
    seedRegistration('REG-B1', 'Career Fair', ['payment' => '₱100.00', 'payment_status' => 'Paid']);

    // The fixture resolves a title to the first event carrying it, so all three
    // land on EVE-A. Move the one that belongs to EVE-B.
    Registration::where('reference', 'REG-B1')
        ->update(['event_id' => Event::where('reference', 'EVE-B')->value('id')]);

    $response = $this->getJson('/api/reports')->assertOk()->json();

    expect($response['summary']['events'])->toBe(2)
        ->and($response['summary']['registrations'])->toBe(3);

    // events, registrations and financial are all mapped from the same ordered
    // event set, so row i of each refers to the same event.
    $registrations = collect($response['registrations'])->keyBy(fn (array $row, int $i) => $response['events'][$i]['reference']);
    $financial = collect($response['financial'])->keyBy(fn (array $row, int $i) => $response['events'][$i]['reference']);

    expect($registrations['EVE-A']['registered'])->toBe(2)
        ->and($registrations['EVE-B']['registered'])->toBe(1);

    // Income must follow the same split rather than reporting 300 on both.
    expect($financial['EVE-A']['income'])->toBe(200)
        ->and($financial['EVE-B']['income'])->toBe(100)
        ->and($financial['EVE-A']['net'])->toBe(-800)
        ->and($financial['EVE-B']['net'])->toBe(-1900);
});

test('a registration whose event no longer exists is left out of the totals', function () {
    Sanctum::actingAs(UserAccount::create([
        'reference' => 'USR-ADMIN',
        'name' => 'Admin',
        'email' => 'admin-reports5@tmc.edu.ph',
        'role' => 'Admin',
        'status' => 'Active',
        'password' => 'password',
    ]));

    seedEvent('EVE-1', ['title' => 'Live Event', 'event_date' => '2026-09-10']);
    seedRegistration('REG-1', 'Live Event', ['payment_status' => 'Paid']);

    // An orphan: the title survives on the row but the event is gone, so there
    // is no id to attribute it to. Reporting it against "Live Event" because
    // the strings match is the guess the backfill migration refuses to make.
    $orphan = seedRegistration('REG-ORPHAN', 'Live Event', ['payment_status' => 'Paid']);
    $orphan->forceFill(['event_id' => null])->save();

    $this->getJson('/api/reports')
        ->assertOk()
        ->assertJsonPath('summary.registrations', 1)
        ->assertJsonPath('summary.registrations_paid', 1)
        ->assertJsonPath('registrations.0.registered', 1);
});

test('settings can be read and persisted by admins', function () {
    Sanctum::actingAs(UserAccount::create([
        'reference' => 'USR-ADMIN',
        'name' => 'Admin',
        'email' => 'admin-settings@tmc.edu.ph',
        'role' => 'Admin',
        'status' => 'Active',
        'password' => 'password',
    ]));

    $this->getJson('/api/settings')
        ->assertOk()
        ->assertJsonStructure(['general', 'notifications', 'security', 'roles_permissions', 'logo_url']);

    $this->putJson('/api/settings', [
        'general' => ['system_name' => 'TMC EventEase', 'institution' => 'Trinidad Municipal College', 'contact_email' => 'contact@tmc.edu.ph', 'timezone' => 'Asia/Manila (GMT+8)'],
        'notifications' => ['new_registration' => false, 'weekly_digest' => true],
        'security' => ['two_factor' => true, 'session_timeout' => '60'],
    ])->assertOk();

    $this->getJson('/api/settings')
        ->assertJsonPath('general.system_name', 'TMC EventEase')
        ->assertJsonPath('notifications.new_registration', false)
        ->assertJsonPath('security.two_factor', true)
        ->assertJsonPath('security.session_timeout', '60');
});

test('only admins can read or change settings', function () {
    $staff = UserAccount::create([
        'reference' => 'USR-STAFF',
        'name' => 'Student',
        'email' => 'staff-settings@tmc.edu.ph',
        'role' => 'Student',
        'status' => 'Active',
        'password' => 'password',
    ]);

    Sanctum::actingAs($staff);

    // Settings are admin-only on the web back office. Student reads and
    // writes both 403; only Admin passes requireAdmin.
    $this->getJson('/api/settings')->assertForbidden();

    $this->putJson('/api/settings', ['general' => ['system_name' => 'Nope']])->assertStatus(403);
});

test('authenticated users can change their own password', function () {
    $account = UserAccount::create([
        'reference' => 'USR-PW',
        'name' => 'Password User',
        'email' => 'pw@tmc.edu.ph',
        'role' => 'Student',
        'status' => 'Active',
        'password' => 'old-password',
    ]);

    Sanctum::actingAs($account);

    $this->putJson('/api/settings/password', [
        'current_password' => 'old-password',
        'new_password' => 'new-password-1',
        'new_password_confirmation' => 'new-password-1',
    ])->assertOk();

    $this->postJson('/api/auth/login', ['email' => 'pw@tmc.edu.ph', 'password' => 'new-password-1'])
        ->assertOk();
});

test('changing password requires the correct current password', function () {
    $account = UserAccount::create([
        'reference' => 'USR-PW2',
        'name' => 'Password User',
        'email' => 'pw2@tmc.edu.ph',
        'role' => 'Student',
        'status' => 'Active',
        'password' => 'old-password',
    ]);

    Sanctum::actingAs($account);

    $this->putJson('/api/settings/password', [
        'current_password' => 'wrong',
        'new_password' => 'new-password-1',
        'new_password_confirmation' => 'new-password-1',
    ])->assertStatus(422);
});
