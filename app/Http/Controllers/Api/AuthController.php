<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\UserAccount;
use App\Support\AcademicStructure;
use Illuminate\Auth\Events\PasswordReset;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Password;
use Illuminate\Validation\Rule;

class AuthController extends Controller
{
    /**
     * Roles a visitor may request during self-registration. Administrator
     * accounts are only ever created by an existing admin in User Accounts.
     */
    private const SELF_SERVICE_ROLES = ['Student'];

    /**
     * Role assigned when a registration request does not ask for one.
     */
    private const DEFAULT_ROLE = 'Student';

    /** Authenticate a user for the mobile-facing API. */
    public function login(Request $request)
    {
        return $this->authenticate($request);
    }

    /** Authenticate an administrator for the web-admin application. */
    public function adminLogin(Request $request)
    {
        return $this->authenticate($request, 'Admin');
    }

    /** Send a short-lived reset link without revealing whether an email exists. */
    public function sendPasswordResetLink(Request $request)
    {
        $validated = $request->validate([
            'email' => ['required', 'email', 'max:255'],
        ]);

        $status = Password::broker('user_accounts')->sendResetLink($validated);

        if ($status === Password::RESET_THROTTLED) {
            return response()->json([
                'message' => 'A reset link was requested recently. Please wait before trying again.',
            ], 429);
        }

        return response()->json([
            'message' => 'If an active account uses that email, a password reset link has been sent.',
        ]);
    }

    /** Apply a valid reset token and revoke sessions created with the old password. */
    public function resetPassword(Request $request)
    {
        $validated = $request->validate([
            'email' => ['required', 'email', 'max:255'],
            'token' => ['required', 'string'],
            'password' => ['required', 'string', 'min:8', 'max:255', 'confirmed'],
        ]);

        $status = Password::broker('user_accounts')->reset(
            $validated,
            function (UserAccount $account, string $password): void {
                $account->forceFill(['password' => $password])->save();
                $account->tokens()->delete();
                event(new PasswordReset($account));
            }
        );

        if ($status !== Password::PASSWORD_RESET) {
            return response()->json([
                'message' => __($status),
            ], 422);
        }

        return response()->json(['message' => 'Your password has been reset. You can now sign in.']);
    }

    private function authenticate(Request $request, ?string $requiredRole = null)
    {
        $validated = $request->validate([
            // The mobile client signs in with its School ID; the web admin
            // client continues to use email. Supporting both keeps a single
            // token endpoint compatible with both clients.
            'email' => ['required_without:school_id', 'nullable', 'email', 'max:255'],
            'school_id' => ['required_without:email', 'nullable', 'string', 'max:50'],
            'password' => ['required', 'string', 'max:255'],
        ]);

        $account = filled($validated['school_id'] ?? null)
            ? UserAccount::where('student_id', trim($validated['school_id']))->first()
            : UserAccount::where('email', $validated['email'])->first();

        if (! $account || ! Hash::check($validated['password'], $account->password)) {
            return response()->json(['message' => 'Invalid email or password.'], $requiredRole ? 422 : 401);
        }

        if ($requiredRole && $account->role !== $requiredRole) {
            return response()->json(['message' => 'Invalid email or password.'], 422);
        }

        if ($account->status === 'Suspended') {
            return response()->json([
                'message' => 'Your account has been suspended. Please contact an administrator.',
                'status' => 'Suspended',
            ], 403);
        }

        if ($account->status !== 'Active') {
            return response()->json([
                'message' => 'Your account is not active yet.',
                'status' => $account->status,
            ], 403);
        }

        $issuedToken = $account->createToken($request->string('device', 'browser')->toString());
        $token = $issuedToken->plainTextToken;

        $responseUser = $account->toArray();
        if ($requiredRole === null) {
            // The Flutter app models roles with lowercase identifiers. Keep the
            // account's canonical title-case role in storage and in /auth/me.
            $responseUser['role'] = strtolower($account->role);
        }

        $response = [
            'user' => $responseUser,
            'token' => $token,
        ];

        if ($requiredRole === null) {
            // Keep `token` for existing API consumers while also returning the
            // names and UTC expiry expected by the Flutter login client.
            $expirationMinutes = (int) (config('sanctum.expiration') ?? 1440);
            $expiresAt = $issuedToken->accessToken->expires_at
                ?? now()->addMinutes($expirationMinutes);

            $response['access_token'] = $token;
            $response['expires_at'] = $expiresAt->copy()->utc()->toISOString();
        }

        return response()->json($response);
    }

    /**
     * Invalidate the current API token.
     */
    public function logout(Request $request)
    {
        $request->user()->currentAccessToken()->delete();

        return response()->json(['message' => 'Logged out.']);
    }

    /**
     * Return the currently authenticated account.
     */
    public function me(Request $request)
    {
        return response()->json($request->user());
    }

    /** Update the editable fields on the signed-in student's profile. */
    public function updateProfile(Request $request)
    {
        $user = $request->user();

        if ($user->role !== 'Student') {
            return response()->json(['message' => 'Only students may update this profile.'], 403);
        }

        $course = $request->input('course');
        if (is_string($course)) {
            $request->merge(['course' => AcademicStructure::normalizeCourse($course) ?? $course]);
        }

        $year = $request->input('year');
        if (is_string($year)) {
            $request->merge(['year' => AcademicStructure::normalizeYear($year) ?? $year]);
        }

        $validated = $request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:255'],
            'course' => ['sometimes', 'required', 'string', Rule::in(AcademicStructure::COURSES)],
            'year' => ['sometimes', 'required', 'string', Rule::in(AcademicStructure::YEARS)],
            'block_no' => ['sometimes', 'nullable', 'string', 'max:50'],
        ]);

        if ($validated === []) {
            return response()->json(['message' => 'Provide at least one profile field to update.'], 422);
        }

        $user->fill($validated)->save();

        return response()->json($user->fresh());
    }

    /** Register a mobile-facing student, organizer, or staff account. */
    public function register(Request $request)
    {
        // The current mobile registration form calls this identifier
        // `school_id`; the web/API account model stores it as `student_id`.
        if (! $request->filled('student_id') && $request->filled('school_id')) {
            $request->merge(['student_id' => $request->input('school_id')]);
        }

        $course = $request->input('course');
        if (is_string($course)) {
            $request->merge(['course' => AcademicStructure::normalizeCourse($course) ?? $course]);
        }

        $year = $request->input('year');
        if (is_string($year)) {
            $request->merge(['year' => AcademicStructure::normalizeYear($year) ?? $year]);
        }

        $studentId = $request->input('student_id');
        if (is_string($studentId)) {
            $request->merge(['student_id' => trim($studentId) ?: null]);
        }

        $email = $request->input('email');
        $revived = is_string($email)
            ? UserAccount::withTrashed()->where('email', trim($email))->first()
            : null;
        $studentIdUnique = Rule::unique('user_accounts', 'student_id');
        if ($revived) {
            $studentIdUnique->ignore($revived->getKey());
        }

        $validated = $request->validate([
            'name' => ['sometimes', 'required_without_all:firstName,lastName', 'string', 'max:255'],
            'firstName' => ['required_without:name', 'string', 'max:255'],
            'lastName' => ['required_without:name', 'string', 'max:255'],
            'email' => ['required', 'email', 'max:255', Rule::unique('user_accounts', 'email')->whereNull('deleted_at')],
            'student_id' => ['required', 'string', 'regex:/^\d{2}-\d{6}$/', 'max:9', $studentIdUnique],
            'course' => ['required', 'string', Rule::in(AcademicStructure::COURSES)],
            'year' => ['required', 'string', Rule::in(AcademicStructure::YEARS)],
            'block_no' => ['nullable', 'string', 'max:50'],
            'role' => ['sometimes', 'string', Rule::in(self::SELF_SERVICE_ROLES)],
            'password' => ['required', 'string', 'min:8', 'max:255'],
        ], [
            'student_id.regex' => 'Student ID must contain two digits, a dash, then six digits (for example, 12-345678).',
        ]);

        $name = isset($validated['firstName']) || isset($validated['lastName'])
            ? trim(($validated['firstName'] ?? '').' '.($validated['lastName'] ?? ''))
            : trim($validated['name']);

        $details = [
            'reference' => $this->nextAccountReference(),
            'student_id' => $validated['student_id'] ?? $revived?->student_id,
            'name' => $name,
            'email' => $validated['email'],
            'role' => $validated['role'] ?? self::DEFAULT_ROLE,
            'status' => 'Pending',
            'course' => $validated['course'],
            'year' => $validated['year'],
            'block_no' => $validated['block_no'] ?? null,
            'date' => now()->format('Y-m-d'),
            'password' => Hash::make($validated['password']),
        ];

        // The uniqueness rule above ignores soft-deleted rows, but the database
        // index does not, so a deleted address would otherwise blow up with a
        // 500 here. Reviving the row keeps the index intact and lets somebody
        // who was removed sign themselves up again.
        if ($revived) {
            $revived->restore();
            $account = $revived->fill($details);
            $account->save();
        } else {
            $account = UserAccount::create($details);
        }

        return response()->json($account->fresh(), 201);
    }

    /**
     * Resolve the next account reference from the highest reference in the table
     * instead of a row count, so references stay unique even after deletions.
     *
     * Trashed rows are included on purpose: they still occupy their reference
     * under the database index, so skipping them would eventually hand out a
     * reference that already exists and fail the insert.
     */
    private function nextAccountReference(): string
    {
        $last = UserAccount::withTrashed()->orderByDesc('id')->value('reference');

        $max = $last ? (int) substr((string) $last, 4) : 3209;

        return 'USR-'.str_pad((string) ($max + 1), 4, '0', STR_PAD_LEFT);
    }
}
