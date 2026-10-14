<?php

use App\Http\Middleware\SecurityHeaders;
use App\Models\Registration;
use App\Models\UserAccount;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\App;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\PersonalAccessToken;
use Laravel\Sanctum\Sanctum;

uses(RefreshDatabase::class);

function securityAccount(array $overrides = []): UserAccount
{
    static $sequence = 0;
    $sequence++;

    return UserAccount::create(array_merge([
        'reference' => 'USR-SEC-'.str_pad((string) $sequence, 3, '0', STR_PAD_LEFT),
        'name' => 'Security User',
        'email' => 'security'.$sequence.'@tmc.edu.ph',
        'role' => 'Student',
        'status' => 'Active',
        'password' => 'password',
    ], $overrides));
}

/* ---------------------------------------------------------------- throttling */

test('login is throttled after five attempts', function () {
    securityAccount(['email' => 'throttle@tmc.edu.ph']);

    for ($attempt = 1; $attempt <= 5; $attempt++) {
        $this->postJson('/api/auth/login', ['email' => 'throttle@tmc.edu.ph', 'password' => 'wrong'])
            ->assertUnauthorized();
    }

    $this->postJson('/api/auth/login', ['email' => 'throttle@tmc.edu.ph', 'password' => 'wrong'])
        ->assertStatus(429)
        ->assertJsonPath('message', 'Too many login attempts. Please try again in a minute.');
});

test('registration is throttled after three attempts', function () {
    for ($attempt = 1; $attempt <= 3; $attempt++) {
        $this->postJson('/api/auth/register', [
            'firstName' => 'Ana',
            'lastName' => 'Cruz',
            'email' => 'ana'.$attempt.'@student.tmc.edu.ph',
            'course' => 'BS Information Technology',
            'year' => '2',
            'password' => 'Password123!',
        ])->assertStatus(201);
    }

    $this->postJson('/api/auth/register', [
        'firstName' => 'Ana',
        'lastName' => 'Cruz',
        'email' => 'ana4@student.tmc.edu.ph',
        'course' => 'BS Information Technology',
        'year' => '2',
        'password' => 'Password123!',
    ])->assertStatus(429);
});

/* ------------------------------------------------------------ password resets */

test('staff cannot reset another account password', function () {
    $staff = securityAccount(['reference' => 'USR-STF', 'email' => 'staff-sec@tmc.edu.ph', 'role' => 'Staff']);
    $student = securityAccount(['reference' => 'USR-STU', 'email' => 'student-sec@tmc.edu.ph', 'role' => 'Student']);

    Sanctum::actingAs($staff);

    $this->putJson('/api/user-accounts/USR-STU', ['password' => 'new-password-1'])
        ->assertStatus(403);

    expect(Hash::check('new-password-1', $student->refresh()->password))->toBeFalse();
});

test('changing your own password on the account endpoint requires the current password', function () {
    $staff = securityAccount(['reference' => 'USR-SELF', 'email' => 'self-sec@tmc.edu.ph', 'role' => 'Staff']);

    Sanctum::actingAs($staff);

    $this->putJson('/api/user-accounts/USR-SELF', ['password' => 'new-password-1'])
        ->assertStatus(422);

    expect(Hash::check('new-password-1', $staff->refresh()->password))->toBeFalse();

    $this->putJson('/api/user-accounts/USR-SELF', [
        'password' => 'new-password-1',
        'current_password' => 'password',
    ])->assertOk();

    expect(Hash::check('new-password-1', $staff->refresh()->password))->toBeTrue();
});

test('an administrator can reset another account password', function () {
    $admin = securityAccount(['reference' => 'USR-ADM', 'email' => 'admin-sec@tmc.edu.ph', 'role' => 'Admin']);
    $student = securityAccount(['reference' => 'USR-STU2', 'email' => 'student2-sec@tmc.edu.ph', 'role' => 'Student']);

    Sanctum::actingAs($admin);

    $this->putJson('/api/user-accounts/USR-STU2', ['password' => 'reset-password-1'])
        ->assertOk();

    expect(Hash::check('reset-password-1', $student->refresh()->password))->toBeTrue();
});

/* ----------------------------------------------------------------- api tokens */

test('changing your password revokes every other token but keeps the current one', function () {
    $account = securityAccount(['reference' => 'USR-TOK', 'email' => 'tokens@tmc.edu.ph']);

    $other = $account->createToken('other-device');
    $current = $account->createToken('this-device');

    $this->withToken($current->plainTextToken)
        ->putJson('/api/settings/password', [
            'current_password' => 'password',
            'new_password' => 'new-password-1',
            'new_password_confirmation' => 'new-password-1',
        ])->assertOk();

    expect(PersonalAccessToken::whereKey($other->accessToken->getKey())->exists())->toBeFalse();
    expect(PersonalAccessToken::whereKey($current->accessToken->getKey())->exists())->toBeTrue();
    expect(PersonalAccessToken::count())->toBe(1);
});

test('an administrator reset also revokes the target tokens', function () {
    $admin = securityAccount(['reference' => 'USR-ADM2', 'email' => 'admin2-sec@tmc.edu.ph', 'role' => 'Admin']);
    $student = securityAccount(['reference' => 'USR-STU3', 'email' => 'student3-sec@tmc.edu.ph']);

    $student->createToken('browser');

    Sanctum::actingAs($admin);

    $this->putJson('/api/user-accounts/USR-STU3', ['password' => 'reset-password-1'])->assertOk();

    expect(PersonalAccessToken::count())->toBe(0);
});

test('a revoked token can no longer authenticate', function () {
    $account = securityAccount(['reference' => 'USR-REV', 'email' => 'revoked@tmc.edu.ph']);

    $token = $account->createToken('browser');
    $account->tokens()->delete();

    $this->withToken($token->plainTextToken)->getJson('/api/auth/me')->assertStatus(401);
});

/* --------------------------------------------------------- audit integrity */

test('activity log entries record the authenticated actor, not the request body', function () {
    $admin = securityAccount([
        'reference' => 'USR-AUD',
        'name' => 'Audit Admin',
        'email' => 'audit@tmc.edu.ph',
        'role' => 'Admin',
    ]);

    Sanctum::actingAs($admin);

    $response = $this->postJson('/api/activity-logs', [
        'timestamp' => '1999-01-01 00:00:00',
        'user' => 'Somebody Else',
        'role' => 'Student',
        'category' => 'Events',
        'action' => 'Forged entry',
        'details' => 'attempted forgery',
    ])->assertStatus(201)->json();

    expect($response['user'])->toBe('Audit Admin');
    expect($response['role'])->toBe('Admin');
    expect($response['timestamp'])->not->toBe('1999-01-01 00:00:00');
    expect($response['timestamp'])->toStartWith(now()->format('Y-m-d'));
});

/* --------------------------------------------------------- account status */

test('a suspended account cannot use a token issued before the suspension', function () {
    $account = securityAccount([
        'reference' => 'USR-LOCK',
        'name' => 'Locked Out',
        'email' => 'locked@tmc.edu.ph',
        'role' => 'Staff',
    ]);

    $token = $account->createToken('browser')->plainTextToken;

    $this->withToken($token)->getJson('/api/auth/me')->assertOk();

    $account->update(['status' => 'Suspended']);

    $this->withToken($token)->getJson('/api/auth/me')
        ->assertStatus(403)
        ->assertJsonPath('status', 'Suspended');

    // The lockout also destroys the token, so it cannot be replayed later.
    expect(PersonalAccessToken::count())->toBe(0);
});

test('a pending account cannot use a token either', function () {
    $account = securityAccount([
        'reference' => 'USR-PEND',
        'name' => 'Still Pending',
        'email' => 'pending-sec@tmc.edu.ph',
        'status' => 'Active',
    ]);

    $token = $account->createToken('browser')->plainTextToken;

    $account->update(['status' => 'Pending']);

    $this->withToken($token)->getJson('/api/auth/me')
        ->assertStatus(403)
        ->assertJsonPath('status', 'Pending');
});

test('suspending an account revokes its tokens so it is locked out everywhere', function () {
    $admin = securityAccount(['reference' => 'USR-ADM3', 'email' => 'admin3-sec@tmc.edu.ph', 'role' => 'Admin']);
    $staff = securityAccount(['reference' => 'USR-TGT', 'email' => 'target-sec@tmc.edu.ph', 'role' => 'Staff']);

    $staff->createToken('phone');
    $staff->createToken('laptop');

    Sanctum::actingAs($admin);

    $this->putJson('/api/user-accounts/USR-TGT', ['status' => 'Suspended'])
        ->assertOk()
        ->assertJsonPath('status', 'Suspended');

    expect(PersonalAccessToken::count())->toBe(0);
});

test('an active account keeps working after the status check', function () {
    $account = securityAccount(['reference' => 'USR-OK', 'email' => 'fine-sec@tmc.edu.ph', 'role' => 'Staff']);

    $token = $account->createToken('browser')->plainTextToken;

    $this->withToken($token)->getJson('/api/auth/me')->assertOk();
    $this->withToken($token)->getJson('/api/user-accounts')->assertOk();
});

/* ------------------------------------------------------------- pagination */

test('listing endpoints refuse to return an unbounded page', function () {
    Sanctum::actingAs(securityAccount([
        'reference' => 'USR-PAGE',
        'email' => 'page@tmc.edu.ph',
        'role' => 'Admin',
    ]));

    Registration::create([
        'reference' => 'REG-PAGE-1',
        'participant' => 'Maria Santos',
        'email' => 'maria@tmc.edu.ph',
        'event' => 'IT Congress',
    ]);

    $huge = $this->getJson('/api/registrations?per_page=100000')->assertOk();

    expect($huge->json('per_page'))->toBeLessThanOrEqual(200);
    expect($huge->json('data'))->toHaveCount(1);

    // Nonsense values fall back to the default instead of "return everything".
    foreach (['0', '-5', 'abc'] as $value) {
        $response = $this->getJson('/api/registrations?per_page='.$value)->assertOk();

        expect($response->json('per_page'))->toBe(15);
    }
});

/* ---------------------------------------------------------- headers & input */

test('security headers are attached to every response', function () {
    $this->getJson('/api/auth/me')
        ->assertStatus(401)
        ->assertHeader('X-Content-Type-Options', 'nosniff')
        ->assertHeader('X-Frame-Options', 'DENY')
        ->assertHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    $policy = $this->get('/login')->assertOk()->headers->get('Content-Security-Policy');

    expect($policy)->toContain("frame-ancestors 'none'");
    expect($policy)->toContain("object-src 'none'");
    // Even the relaxed development policy must still declare a default.
    expect($policy)->toContain("default-src 'self'");
});

test('the production policy forbids unsafe script sources', function () {
    $middleware = app(SecurityHeaders::class);
    $method = new ReflectionMethod($middleware, 'contentSecurityPolicy');

    App::instance('env', 'local');

    $local = $method->invoke($middleware);

    // The relaxed development policy must still be a real policy: it keeps a
    // default-src and only widens the dev-server sources.
    expect($local)->toContain("default-src 'self'");
    expect($local)->toContain('http://localhost:5173');

    App::instance('env', 'production');

    $production = $method->invoke($middleware);

    expect($production)->toContain("default-src 'self'");
    expect($production)->toContain("script-src 'self'");
    expect($production)->not->toContain("'unsafe-eval'");
    expect($production)->not->toContain('http://localhost:5173');
    expect($production)->toContain("frame-ancestors 'none'");

    expect($production)->not->toBe($local);
});

test('the local policy allows every loopback form of the vite dev server', function () {
    $middleware = app(SecurityHeaders::class);
    $method = new ReflectionMethod($middleware, 'contentSecurityPolicy');

    App::instance('env', 'local');

    $policy = $method->invoke($middleware);

    // Vite advertises the dev server under whichever name the machine resolves
    // "localhost" to, and public/hot plus the <script> tags in app.blade.php are
    // built from it. A browser treats localhost, 127.0.0.1 and [::1] as three
    // distinct origins when matching CSP, so all three have to be present or the
    // dev server's own scripts are blocked and the SPA never boots.
    foreach (['localhost', '127.0.0.1', '[::1]'] as $host) {
        expect($policy)->toContain("http://{$host}:5173");
        expect($policy)->toContain("ws://{$host}:5173");
    }

    // script-src is what actually gates the module scripts the page loads.
    preg_match('/script-src ([^;]+)/', $policy, $matches);
    $scriptSrc = $matches[1];

    foreach (['localhost', '127.0.0.1', '[::1]'] as $host) {
        expect($scriptSrc)->toContain("http://{$host}:5173");
    }
});

test('registration updates reject invalid payment and attendance values', function () {
    Registration::create([
        'reference' => 'REG-1',
        'participant' => 'Maria Santos',
        'email' => 'maria@tmc.edu.ph',
        'event' => 'IT Congress',
        'payment_status' => 'Paid',
        'attendance' => 'Present',
    ]);

    Sanctum::actingAs(securityAccount(['reference' => 'USR-VAL', 'email' => 'valid@tmc.edu.ph', 'role' => 'Admin']));

    $this->putJson('/api/registrations/REG-1', ['payment_status' => 'Bogus'])->assertStatus(422);
    $this->putJson('/api/registrations/REG-1', ['attendance' => 'Bogus'])->assertStatus(422);

    $this->putJson('/api/registrations/REG-1', ['payment_status' => 'Refunded', 'attendance' => 'Excused'])
        ->assertOk()
        ->assertJsonPath('payment_status', 'Refunded')
        ->assertJsonPath('attendance', 'Excused');
});

test('registration role is stored, defaulted and validated', function () {
    Sanctum::actingAs(securityAccount(['reference' => 'USR-REGROLE', 'email' => 'regrole@tmc.edu.ph', 'role' => 'Admin']));

    $this->postJson('/api/registrations', [
        'reference' => 'REG-ROLE-1',
        'participant' => 'Maria Santos',
        'email' => 'maria@tmc.edu.ph',
        'event' => 'IT Congress',
        'role' => 'Organizer',
        'payment_status' => 'N/A',
        'attendance' => 'Not Yet Recorded',
    ])->assertStatus(201)->assertJsonPath('role', 'Organizer');

    // Legacy clients that do not send a role still get a sensible default.
    $this->postJson('/api/registrations', [
        'reference' => 'REG-ROLE-2',
        'participant' => 'John Dela Cruz',
        'email' => 'john@tmc.edu.ph',
        'event' => 'IT Congress',
        'payment_status' => 'N/A',
        'attendance' => 'Not Yet Recorded',
    ])->assertStatus(201)->assertJsonPath('role', 'Student');

    $this->putJson('/api/registrations/REG-ROLE-1', ['role' => 'Bogus'])->assertStatus(422);

    expect(Registration::where('reference', 'REG-ROLE-1')->first()->role)->toBe('Organizer');
});
