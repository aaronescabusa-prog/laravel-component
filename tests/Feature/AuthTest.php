<?php

use App\Models\UserAccount;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\PersonalAccessToken;
use Laravel\Sanctum\Sanctum;

uses(RefreshDatabase::class);

function makeAccount(array $overrides = []): UserAccount
{
    return UserAccount::create(array_merge([
        'reference' => 'USR-'.str_pad((string) random_int(1, 9999), 4, '0', STR_PAD_LEFT),
        'name' => 'Test User',
        'email' => 'test'.random_int(1, 999999).'@tmc.edu.ph',
        'role' => 'Admin',
        'status' => 'Active',
        'password' => 'password',
    ], $overrides));
}

test('login issues a real Sanctum token for an active account', function () {
    $account = makeAccount(['email' => 'admin@tmc.edu.ph', 'role' => 'Admin']);

    $response = $this->postJson('/api/auth/login', [
        'email' => 'admin@tmc.edu.ph',
        'password' => 'password',
    ]);

    $response->assertOk()
        ->assertJson([
            'user' => ['reference' => $account->reference],
        ])
        ->assertJsonStructure(['token']);

    expect(PersonalAccessToken::count())->toBe(1);
});

test('admin login issues a token only for active administrator accounts', function () {
    $admin = makeAccount(['email' => 'admin-portal@tmc.edu.ph', 'role' => 'Admin']);

    $this->postJson('/api/auth/admin-login', [
        'email' => $admin->email,
        'password' => 'password',
    ])->assertOk()
        ->assertJson(['user' => ['reference' => $admin->reference]])
        ->assertJsonStructure(['token']);

    expect(PersonalAccessToken::count())->toBe(1);
});

test('admin login rejects non-admin accounts without issuing a token', function () {
    makeAccount(['email' => 'student@tmc.edu.ph', 'role' => 'Student']);

    $this->postJson('/api/auth/admin-login', [
        'email' => 'student@tmc.edu.ph',
        'password' => 'password',
    ])->assertStatus(422)
        ->assertJson(['message' => 'Invalid email or password.']);

    expect(PersonalAccessToken::count())->toBe(0);
});

test('mobile login remains available for active non-admin accounts', function () {
    $student = makeAccount(['email' => 'student-mobile@tmc.edu.ph', 'role' => 'Student']);

    $this->postJson('/api/auth/login', [
        'email' => $student->email,
        'password' => 'password',
    ])->assertOk()
        ->assertJson(['user' => ['role' => 'student']])
        ->assertJsonStructure(['token', 'access_token', 'expires_at']);
});

test('login rejects invalid credentials', function () {
    makeAccount(['email' => 'admin@tmc.edu.ph']);

    $this->postJson('/api/auth/login', ['email' => 'admin@tmc.edu.ph', 'password' => 'wrong'])
        ->assertUnauthorized();
});

test('login rejects suspended accounts with a suspension message', function () {
    makeAccount(['email' => 'suspended@tmc.edu.ph', 'role' => 'Student', 'status' => 'Suspended']);

    $this->postJson('/api/auth/login', ['email' => 'suspended@tmc.edu.ph', 'password' => 'password'])
        ->assertStatus(403)
        ->assertJson(['status' => 'Suspended'])
        ->assertJsonPath('message', 'Your account has been suspended. Please contact an administrator.');
});

test('login rejects accounts that are not active yet', function () {
    makeAccount(['email' => 'pending@tmc.edu.ph', 'role' => 'Student', 'status' => 'Pending']);

    $this->postJson('/api/auth/login', ['email' => 'pending@tmc.edu.ph', 'password' => 'password'])
        ->assertStatus(403);
});

test('register creates a pending student account', function () {
    $response = $this->postJson('/api/auth/register', [
        'firstName' => 'Ana',
        'lastName' => 'Cruz',
        'email' => 'ana.cruz@student.tmc.edu.ph',
        'course' => 'BS Information Technology',
        'year' => '2',
        'password' => 'Password123!',
    ]);

    $response->assertStatus(201)
        ->assertJson([
            'name' => 'Ana Cruz',
            'role' => 'Student',
            'status' => 'Pending',
            'email' => 'ana.cruz@student.tmc.edu.ph',
        ]);

    expect(UserAccount::where('email', 'ana.cruz@student.tmc.edu.ph')->first()->status)->toBe('Pending');
});

test('register honours the requested self-service role', function () {
    $response = $this->postJson('/api/auth/register', [
        'firstName' => 'Liza',
        'lastName' => 'Fernandez',
        'email' => 'liza.fernandez@tmc.edu.ph',
        'course' => 'BS Information Technology',
        'year' => '2',
        'role' => 'Organizer',
        'password' => 'Password123!',
    ]);

    $response->assertStatus(201)
        ->assertJson([
            'name' => 'Liza Fernandez',
            'role' => 'Organizer',
            'status' => 'Pending',
        ]);

    expect(UserAccount::where('email', 'liza.fernandez@tmc.edu.ph')->first()->role)->toBe('Organizer');
});

test('register refuses to self-assign the administrator role', function () {
    $response = $this->postJson('/api/auth/register', [
        'firstName' => 'Mallory',
        'lastName' => 'Root',
        'email' => 'mallory@tmc.edu.ph',
        'course' => 'BS Criminology',
        'year' => '4',
        'role' => 'Admin',
        'password' => 'Password123!',
    ]);

    $response->assertStatus(422)->assertJsonValidationErrors('role');

    expect(UserAccount::where('email', 'mallory@tmc.edu.ph')->exists())->toBeFalse();
});

test('register rejects duplicate emails', function () {
    makeAccount(['email' => 'ana.cruz@student.tmc.edu.ph']);

    $this->postJson('/api/auth/register', [
        'firstName' => 'Ana',
        'lastName' => 'Cruz',
        'email' => 'ana.cruz@student.tmc.edu.ph',
        'course' => 'BS Information Technology',
        'year' => '2',
        'password' => 'Password123!',
    ])->assertStatus(422);
});

test('register revives a deleted account instead of failing on the unique index', function () {
    $removed = makeAccount([
        'email' => 'ana.cruz@student.tmc.edu.ph',
        'name' => 'Ana Cruz',
        'role' => 'Student',
        'status' => 'Active',
    ]);

    $removed->delete();

    $response = $this->postJson('/api/auth/register', [
        'firstName' => 'Ana',
        'lastName' => 'Cruz',
        'email' => 'ana.cruz@student.tmc.edu.ph',
        'course' => 'BS Information Technology',
        'year' => '2',
        'password' => 'Password123!',
    ])->assertStatus(201);

    // Same row comes back, and the new password is the one that now works.
    expect($response->json('id'))->toBe($removed->id)
        ->and(UserAccount::onlyTrashed()->count())->toBe(0)
        ->and(UserAccount::where('email', 'ana.cruz@student.tmc.edu.ph')->count())->toBe(1);

    $revived = UserAccount::find($removed->id);

    expect($revived->status)->toBe('Pending')
        ->and(Hash::check('Password123!', $revived->password))->toBeTrue()
        ->and(Hash::check('password', $revived->password))->toBeFalse();
});

test('register never reissues the reference of a deleted account', function () {
    $removed = makeAccount(['email' => 'gone@tmc.edu.ph']);

    $removed->delete();

    $created = $this->postJson('/api/auth/register', [
        'firstName' => 'New',
        'lastName' => 'Signup',
        'email' => 'fresh@tmc.edu.ph',
        'course' => 'BS Information Technology',
        'year' => '2',
        'password' => 'Password123!',
    ])->assertStatus(201);

    // A trashed row still holds its reference under the database index, so the
    // generator has to look past the soft deletes and move on from there.
    expect($created->json('reference'))->not->toBe($removed->reference)
        ->and(UserAccount::withTrashed()->pluck('reference')->unique()->count())
        ->toBe(UserAccount::withTrashed()->count());
});

test('me returns the authenticated account', function () {
    $account = makeAccount();

    Sanctum::actingAs($account);

    $this->getJson('/api/auth/me')
        ->assertOk()
        ->assertJson(['reference' => $account->reference]);
});

test('logout revokes the current token', function () {
    $account = makeAccount();
    $token = $account->createToken('browser')->plainTextToken;

    $this->withToken($token)
        ->postJson('/api/auth/logout')
        ->assertOk();

    expect(PersonalAccessToken::count())->toBe(0);
});

test('unauthenticated requests to protected routes are rejected', function () {
    $this->getJson('/api/events')->assertStatus(401);
    $this->postJson('/api/events', [])->assertStatus(401);
    $this->getJson('/api/settings')->assertStatus(401);
    $this->getJson('/api/reports')->assertStatus(401);
});
