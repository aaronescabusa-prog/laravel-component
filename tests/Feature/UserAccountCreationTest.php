<?php

use App\Models\UserAccount;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;

/*
 * The contract the User Accounts screen has to satisfy when it posts a new
 * account.
 *
 * This exists because the screen used to strip the password out of the row
 * before saving it, which made every "Add User" fail with "The password field is
 * required." - while the screen itself reported success. The rules below are
 * what that screen is written against.
 */

uses(RefreshDatabase::class);

function creationAdmin(): UserAccount
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

function accountPayload(array $overrides = []): array
{
    return array_merge([
        'reference' => 'USR-2215',
        'name' => 'Paolo Ramos',
        'email' => 'paulo.ramos@student.tmc.edu.ph',
        'role' => 'Student',
        'status' => 'Pending',
        'course' => 'BS Information Technology',
        'block_no' => 'B3',
        'year' => '3',
        'date' => '2026-10-02',
        'password' => 'secret1234',
    ], $overrides);
}

test('an account can be created with a password and can then sign in', function () {
    $this->actingAs(creationAdmin(), 'sanctum');

    // Active, because a Pending account is refused at the door by design.
    $this->postJson('/api/user-accounts', accountPayload(['status' => 'Active']))
        ->assertCreated()
        ->assertJsonPath('reference', 'USR-2215');

    // The point of the whole exercise: the hash must actually work, otherwise
    // the account is created but nobody can ever use it.
    expect(UserAccount::where('reference', 'USR-2215')->count())->toBe(1);

    $this->postJson('/api/auth/login', [
        'email' => 'paulo.ramos@student.tmc.edu.ph',
        'password' => 'secret1234',
    ])->assertOk();
});

test('creating an account without a password is refused', function () {
    $this->actingAs(creationAdmin(), 'sanctum');

    $payload = accountPayload();
    unset($payload['password']);

    $this->postJson('/api/user-accounts', $payload)
        ->assertStatus(422)
        ->assertJsonValidationErrors('password');

    expect(UserAccount::where('reference', 'USR-2215')->exists())->toBeFalse();
});

test('staff and organizer are not accepted as account roles', function () {
    $this->actingAs(creationAdmin(), 'sanctum');

    foreach (['Staff', 'Organizer'] as $role) {
        $this->postJson('/api/user-accounts', accountPayload([
            'reference' => 'USR-'.strtoupper($role),
            'email' => strtolower($role).'@tmc.edu.ph',
            'role' => $role,
        ]))->assertStatus(422)->assertJsonValidationErrors('role');
    }
});

test('a password shorter than eight characters is refused', function () {
    $this->actingAs(creationAdmin(), 'sanctum');

    $this->postJson('/api/user-accounts', accountPayload(['password' => 'short']))
        ->assertStatus(422)
        ->assertJsonValidationErrors('password');
});

test('the password is stored hashed rather than in the clear', function () {
    $this->actingAs(creationAdmin(), 'sanctum');

    $this->postJson('/api/user-accounts', accountPayload())->assertCreated();

    $stored = UserAccount::where('reference', 'USR-2215')->first()->password;

    expect($stored)->not->toBe('secret1234')
        ->and(Hash::check('secret1234', $stored))->toBeTrue();
});

test('the stored password is never echoed back to the client', function () {
    $this->actingAs(creationAdmin(), 'sanctum');

    $this->postJson('/api/user-accounts', accountPayload())
        ->assertCreated()
        ->assertJsonMissing(['password' => 'secret1234']);
});

test('duplicate email and duplicate reference are both refused', function () {
    $this->actingAs(creationAdmin(), 'sanctum');

    $this->postJson('/api/user-accounts', accountPayload())->assertCreated();

    // Same email under a fresh reference is the collision that matters: one
    // person cannot hold two accounts.
    $this->postJson('/api/user-accounts', accountPayload(['reference' => 'USR-2216']))
        ->assertStatus(422)->assertJsonValidationErrors('email');

    // A different person claiming an existing reference is the other one.
    $this->postJson('/api/user-accounts', accountPayload(['email' => 'someone.else@student.tmc.edu.ph']))
        ->assertStatus(422)->assertJsonValidationErrors('reference');
});

test('a new account lands as Pending so it cannot sign in until cleared', function () {
    $this->actingAs(creationAdmin(), 'sanctum');

    $this->postJson('/api/user-accounts', accountPayload())->assertCreated();

    $this->postJson('/api/auth/login', [
        'email' => 'paulo.ramos@student.tmc.edu.ph',
        'password' => 'secret1234',
    ])->assertStatus(403);
});

test('only an administrator can create an Admin account', function () {
    $staff = UserAccount::create([
        'reference' => 'USR-STAFF',
        'name' => 'Ana Cruz',
        'email' => 'ana.cruz@student.tmc.edu.ph',
        'role' => 'Student',
        'status' => 'Active',
        'password' => 'password',
    ]);

    $this->actingAs($staff, 'sanctum');

    $this->postJson('/api/user-accounts', accountPayload(['role' => 'Admin']))
        ->assertStatus(403);

    expect(UserAccount::where('reference', 'USR-2215')->exists())->toBeFalse();
});

test('editing an account is not blocked by its own email and reference', function () {
    $this->actingAs(creationAdmin(), 'sanctum');

    $this->postJson('/api/user-accounts', accountPayload())->assertCreated();

    // Every field sent back unchanged, which is what the screen does on a plain
    // edit. The uniqueness rules must exclude the row being edited.
    $this->putJson('/api/user-accounts/USR-2215', accountPayload(['name' => 'Paolo R. Ramos']))
        ->assertOk()
        ->assertJsonPath('name', 'Paolo R. Ramos');
});

test('a deleted account does not keep its email and reference reserved', function () {
    $this->actingAs(creationAdmin(), 'sanctum');

    $original = $this->postJson('/api/user-accounts', accountPayload())->assertCreated();
    $originalId = $original->json('id');

    $this->deleteJson('/api/user-accounts/USR-2215')->assertNoContent();
    expect(UserAccount::find($originalId))->toBeNull();

    // Re-adding the same person has to be possible, otherwise the one row you
    // are allowed to delete leaves an address nobody can ever register again.
    $restored = $this->postJson('/api/user-accounts', accountPayload())->assertCreated();

    // The row is revived rather than duplicated, so the id and anything hanging
    // off it survive the delete/add round trip.
    expect($restored->json('id'))->toBe($originalId)
        ->and(UserAccount::where('reference', 'USR-2215')->count())->toBe(1)
        ->and(UserAccount::onlyTrashed()->count())->toBe(0);
});

test('reviving a deleted account applies the newly submitted details', function () {
    $this->actingAs(creationAdmin(), 'sanctum');

    $this->postJson('/api/user-accounts', accountPayload())->assertCreated();
    $this->deleteJson('/api/user-accounts/USR-2215')->assertNoContent();

    $restored = $this->postJson('/api/user-accounts', accountPayload([
        'name' => 'Paolo Ramirez',
        'role' => 'Student',
    ]))->assertCreated();

    expect($restored->json('name'))->toBe('Paolo Ramirez')
        ->and($restored->json('role'))->toBe('Student')
        ->and(UserAccount::withTrashed()->whereNotNull('deleted_at')->count())->toBe(0);
});
