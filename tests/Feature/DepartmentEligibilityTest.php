<?php

use App\Models\Event;
use App\Models\Registration;
use App\Models\UserAccount;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;

uses(RefreshDatabase::class);

function departmentTestAdmin(): UserAccount
{
    return UserAccount::create([
        'reference' => 'USR-DEPT-ADMIN',
        'name' => 'Department Admin',
        'email' => 'dept-admin@tmc.edu.ph',
        'role' => 'Admin',
        'status' => 'Active',
        'password' => 'password',
    ]);
}

function departmentTestStudent(string $reference, string $email, string $course, string $year): UserAccount
{
    return UserAccount::create([
        'reference' => $reference,
        'name' => 'Student '.$reference,
        'email' => $email,
        'role' => 'Student',
        'status' => 'Active',
        'course' => $course,
        'year' => $year,
        'password' => 'password',
    ]);
}

function departmentTestRegistration(string $reference, UserAccount $account, string $eventTitle): array
{
    return [
        'reference' => $reference,
        'participant' => $account->name,
        'email' => $account->email,
        'event' => $eventTitle,
        'payment_status' => 'N/A',
        'attendance' => 'Not Yet Recorded',
    ];
}

test('the academic structure endpoint publishes all TMC departments, programs, and years', function () {
    Sanctum::actingAs(departmentTestAdmin());

    $this->getJson('/api/events/courses')
        ->assertOk()
        ->assertJsonPath('departments.0.code', 'CCS')
        ->assertJsonPath('departments.0.courses.0', 'BS Information Technology')
        ->assertJsonPath('departments.3.code', 'CAS')
        ->assertJsonPath('years', ['1st Year', '2nd Year', '3rd Year', '4th Year']);
});

test('department and year targeting auto-enrols only eligible accounts and enforces capacity', function () {
    Sanctum::actingAs(departmentTestAdmin());

    $eligibleOne = departmentTestStudent('USR-DEPT-1', 'one@tmc.edu.ph', 'BS Information Technology', '3rd Year');
    $eligibleTwo = departmentTestStudent('USR-DEPT-2', 'two@tmc.edu.ph', 'BS Information Technology', '3rd Year');
    $wrongYear = departmentTestStudent('USR-DEPT-3', 'wrong-year@tmc.edu.ph', 'BS Information Technology', '2nd Year');
    $wrongDepartment = departmentTestStudent('USR-DEPT-4', 'wrong-dept@tmc.edu.ph', 'BS Education Major in English', '3rd Year');

    $response = $this->postJson('/api/events', [
        'reference' => 'EVE-DEPT-1',
        'title' => 'CCS Third-Year Forum',
        'category' => 'Seminar',
        'status' => 'Draft',
        'target_department' => 'CCS',
        'target_year' => '3rd Year',
        'capacity' => 1,
    ])->assertCreated()
        ->assertJson([
            'target_department' => 'CCS',
            'target_year' => '3rd Year',
        ]);

    expect($response->json('audience.matched'))->toBe(2)
        ->and($response->json('audience.added'))->toHaveCount(1)
        ->and($response->json('audience.capacity_remaining'))->toBe(0)
        ->and(Registration::where('event', 'CCS Third-Year Forum')->count())->toBe(1)
        ->and(Event::where('reference', 'EVE-DEPT-1')->value('participants'))->toBe(1);

    $this->postJson('/api/registrations', departmentTestRegistration('REG-DEPT-1', $wrongDepartment, 'CCS Third-Year Forum'))
        ->assertUnprocessable()
        ->assertJsonValidationErrors('event')
        ->assertJsonPath('errors.event.0', 'This event is restricted to CCS (College of Computer Studies).');

    $this->postJson('/api/registrations', departmentTestRegistration('REG-DEPT-2', $wrongYear, 'CCS Third-Year Forum'))
        ->assertUnprocessable()
        ->assertJsonPath('errors.event.0', 'This event is restricted to 3rd Year.');

    $this->postJson('/api/registrations', departmentTestRegistration('REG-DEPT-3', $eligibleTwo, 'CCS Third-Year Forum'))
        ->assertUnprocessable()
        ->assertJsonPath('errors.event.0', 'This event has reached its registration capacity.');

    expect(Registration::where('email', $eligibleOne->email)->exists())->toBeTrue()
        ->and(Registration::where('email', $eligibleTwo->email)->exists())->toBeFalse();
});

test('a selected program must belong to the event target department', function () {
    Sanctum::actingAs(departmentTestAdmin());

    $this->postJson('/api/events', [
        'reference' => 'EVE-DEPT-MISMATCH',
        'title' => 'Mismatched Audience',
        'category' => 'Seminar',
        'status' => 'Draft',
        'target_department' => 'CCS',
        'target_course' => 'BS Education Major in English',
    ])->assertUnprocessable()
        ->assertJsonValidationErrors('target_course');
});
