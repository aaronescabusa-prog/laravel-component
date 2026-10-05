<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\UserAccount;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rule;

class AuthController extends Controller
{
    /**
     * Roles a visitor may request during self-registration. Administrator
     * accounts are only ever created by an existing admin in User Accounts.
     */
    private const SELF_SERVICE_ROLES = ['Student', 'Organizer', 'Staff'];

    /**
     * Role assigned when a registration request does not ask for one.
     */
    private const DEFAULT_ROLE = 'Student';

    /**
     * Authenticate an admin/student account.
     */
    public function login(Request $request)
    {
        $validated = $request->validate([
            'email' => ['required', 'email', 'max:255'],
            'password' => ['required', 'string', 'max:255'],
        ]);

        $account = UserAccount::where('email', $validated['email'])->first();

        if (! $account || ! Hash::check($validated['password'], $account->password)) {
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

        $token = $account->createToken($request->string('device', 'browser')->toString())->plainTextToken;

        return response()->json([
            'user' => $account,
            'token' => $token,
        ]);
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

    /**
     * Register a new account. Visitors may request a student, organizer or
     * staff account; administrator accounts are never self-assigned, and the
     * account stays Pending until an admin activates it.
     */
    public function register(Request $request)
    {
        $validated = $request->validate([
            'firstName' => ['required', 'string', 'max:255'],
            'lastName' => ['required', 'string', 'max:255'],
            'email' => ['required', 'email', 'max:255', Rule::unique('user_accounts', 'email')->whereNull('deleted_at')],
            'course' => ['required', 'string', 'max:255'],
            'year' => ['required', 'string', 'max:20'],
            'role' => ['sometimes', 'string', Rule::in(self::SELF_SERVICE_ROLES)],
            'password' => ['required', 'string', 'min:8', 'max:255'],
        ]);

        $details = [
            'reference' => $this->nextAccountReference(),
            'name' => trim($validated['firstName'].' '.$validated['lastName']),
            'email' => $validated['email'],
            'role' => $validated['role'] ?? self::DEFAULT_ROLE,
            'status' => 'Pending',
            'course' => $validated['course'],
            'year' => $validated['year'],
            'date' => now()->format('Y-m-d'),
            'password' => Hash::make($validated['password']),
        ];

        // The uniqueness rule above ignores soft-deleted rows, but the database
        // index does not, so a deleted address would otherwise blow up with a
        // 500 here. Reviving the row keeps the index intact and lets somebody
        // who was removed sign themselves up again.
        $revived = UserAccount::withTrashed()->where('email', $validated['email'])->first();

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
