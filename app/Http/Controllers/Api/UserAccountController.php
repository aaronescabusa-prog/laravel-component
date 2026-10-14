<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\UserAccount;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator as ValidatorContract;

class UserAccountController extends Controller
{
    /**
     * Largest number of accounts one import may carry.
     *
     * Mirrors IMPORT_ROW_LIMIT in resources/js/Users.jsx, which applies the same
     * limit before the file is even sent. The duplicate here is deliberate: the
     * server must not trust a limit that only ever lived in the browser.
     */
    private const IMPORT_ROW_LIMIT = 500;

    /**
     * The rules a single account row must satisfy, whether it arrives from the
     * Add User form or as one line of an imported CSV.
     *
     * Unique checks are scoped to rows that still live. The rules query the
     * table directly and so bypass the SoftDeletes scope on the model, which
     * would let a deleted account reserve its email and reference forever - you
     * could remove somebody and never add them back.
     *
     * @param  int|null  $ignoreId  account to except, when updating one
     */
    private function accountRules(?int $ignoreId = null): array
    {
        $live = function (string $column) use ($ignoreId) {
            $rule = Rule::unique('user_accounts', $column)->whereNull('deleted_at');

            return $ignoreId ? $rule->ignore($ignoreId) : $rule;
        };
        $studentIdUnique = Rule::unique('user_accounts', 'student_id');

        return [
            'reference' => ['required', 'string', 'max:50', $live('reference')],
            // Student IDs remain reserved by soft-deleted rows too, matching
            // the database's unique index and avoiding an insert-time conflict.
            'student_id' => ['nullable', 'string', 'max:50', $studentIdUnique],
            'name' => ['required', 'string', 'max:255'],
            'email' => ['required', 'email', 'max:255', $live('email')],
            'role' => ['required', 'string', Rule::in(['Admin', 'Staff', 'Organizer', 'Student', 'Scanner'])],
            'status' => ['required', 'string', Rule::in(['Active', 'Pending', 'Suspended'])],
            'course' => ['nullable', 'string', 'max:255'],
            'block_no' => ['nullable', 'string', 'max:50'],
            'year' => ['nullable', 'string', 'max:20'],
            'date' => ['nullable', 'string', 'max:20'],
            'password' => ['required', 'string', 'min:8', 'max:255'],
        ];
    }

    /**
     * Create an account, reviving a soft-deleted namesake rather than colliding
     * with the unique index.
     *
     * The database enforces unique() on email and reference across every row,
     * including soft-deleted ones, so validation alone cannot let somebody be
     * removed and later added back. Reviving the old row keeps that index
     * intact and preserves the account id and any history attached to it.
     */
    private function persist(array $validated): UserAccount
    {
        $revived = UserAccount::withTrashed()
            ->where(fn ($query) => $query
                ->where('email', $validated['email'])
                ->orWhere('reference', $validated['reference']))
            ->first();

        if ($revived) {
            $revived->restore();
            $account = $revived->fill($validated);
            $account->save();

            return $account;
        }

        return UserAccount::create($validated);
    }

    /**
     * Display a listing of the resource.
     */
    public function index(Request $request)
    {
        $query = UserAccount::query();

        if ($request->filled('search')) {
            $term = $request->string('search')->toString();
            $query->where(function ($q) use ($term) {
                $q->where('name', 'like', "%{$term}%")
                    ->orWhere('email', 'like', "%{$term}%");
            });
        }

        if ($request->filled('role')) {
            $query->where('role', $request->string('role')->toString());
        }

        if ($request->filled('status')) {
            $query->where('status', $request->string('status')->toString());
        }

        return response()->json($query->orderByDesc('id')->paginate(
            $this->perPage($request)
        ));
    }

    /**
     * Store a newly created resource in storage.
     */
    public function store(Request $request)
    {
        $validated = $request->validate($this->accountRules());

        if ($request->user()->role !== 'Admin' && $validated['role'] === 'Admin') {
            abort(403, 'Only an administrator can create Admin accounts.');
        }

        $account = $this->persist($validated);

        return response()->json($account->fresh(), 201);
    }

    /**
     * Create many accounts from one CSV in a single request.
     *
     * Administrator-only by route, through the `admin` middleware rather than
     * `role:user-accounts`. The ordinary create above stays available to Staff,
     * because adding one user is a much smaller thing to delegate than adding
     * five hundred.
     *
     * Each row is validated and written on its own so that one bad line is
     * reported instead of costing the whole file. Validating the envelope with
     * $request->validate() and each row separately is what allows that: a single
     * bad row cannot fail the request, because it never reaches the envelope
     * rules.
     *
     * Rows carry the line number the client read them from so the dialog can
     * still point at the offending line of the user's file rather than at an
     * index into this request.
     */
    public function import(Request $request)
    {
        $validated = $request->validate([
            'rows' => ['required', 'array', 'min:1', 'max:'.self::IMPORT_ROW_LIMIT],
            'rows.*' => ['array'],
        ]);

        $imported = [];
        $skipped = [];

        foreach ($validated['rows'] as $index => $row) {
            $line = (int) ($row['line'] ?? $index + 1);
            $name = (string) ($row['name'] ?? '(blank row)');

            $validator = Validator::make($row, $this->accountRules());

            if ($validator->fails()) {
                $skipped[] = [
                    'line' => $line,
                    'name' => $name,
                    'reason' => $this->describeFailure($validator),
                ];

                continue;
            }

            $account = $this->persist($validator->validated());

            $imported[] = [
                'line' => $line,
                'name' => $account->name,
                'reference' => $account->reference,
            ];
        }

        return response()->json([
            'imported' => $imported,
            'skipped' => $skipped,
        ]);
    }

    /**
     * A one-line, human-readable reason for a rejected row.
     *
     * Shaped like the message the client used to build for itself from a 422, so
     * the reason column reads the same either way.
     */
    private function describeFailure(ValidatorContract $validator): string
    {
        foreach ($validator->errors()->toArray() as $field => $messages) {
            return $field.': '.implode(', ', $messages);
        }

        return 'That row could not be imported.';
    }

    /**
     * Display the specified resource.
     */
    public function show(UserAccount $userAccount)
    {
        return response()->json($userAccount);
    }

    /**
     * Update the specified resource in storage.
     */
    public function update(Request $request, UserAccount $userAccount)
    {
        $actor = $request->user();
        $isSelf = $actor instanceof UserAccount && $actor->is($userAccount);

        // Step 1: account writes reached this method passed role:user-accounts
        // (Staff may update) but the admin-only creation/deletion live behind
        // requireAdmin. Re-gate here: non-admins may change ONLY their own
        // password (with current_password); every other non-admin write 403s.
        // This keeps Staff self-service working while the back office stays
        // admin-only.
        $nonAdmin = ($actor?->role ?? null) !== 'Admin';

        if ($nonAdmin) {
            $keys = array_map('strval', array_keys($request->all()));
            $passwordOnly = $keys !== [] && count(array_diff($keys, ['password', 'current_password'])) === 0;

            if (! $isSelf || ! $passwordOnly) {
                abort(403, 'Only an administrator can modify accounts.');
            }
        }

        $validated = $request->validate([
            'reference' => ['sometimes', 'string', 'max:50', Rule::unique('user_accounts', 'reference')
                ->whereNull('deleted_at')
                ->ignore($userAccount->id)],
            'student_id' => ['sometimes', 'nullable', 'string', 'max:50', Rule::unique('user_accounts', 'student_id')
                ->ignore($userAccount->id)],
            'name' => ['sometimes', 'required', 'string', 'max:255'],
            'email' => ['sometimes', 'required', 'email', 'max:255', Rule::unique('user_accounts', 'email')
                ->whereNull('deleted_at')
                ->ignore($userAccount->id)],
            'role' => ['sometimes', 'required', 'string', Rule::in(['Admin', 'Staff', 'Organizer', 'Student', 'Scanner'])],
            'status' => ['sometimes', 'required', 'string', Rule::in(['Active', 'Pending', 'Suspended'])],
            'course' => ['nullable', 'string', 'max:255'],
            'block_no' => ['nullable', 'string', 'max:50'],
            'year' => ['nullable', 'string', 'max:20'],
            'date' => ['nullable', 'string', 'max:20'],
            'password' => ['sometimes', 'nullable', 'string', 'min:8', 'max:255'],
            'current_password' => ['sometimes', 'nullable', 'string'],
        ]);

        $requestedRole = $validated['role'] ?? null;
        $replacesPassword = ! empty($validated['password']);

        if ($nonAdmin) {
            if ($requestedRole === 'Admin' || $userAccount->role === 'Admin') {
                abort(403, 'Only an administrator can create or modify Admin accounts.');
            }

            if ($request->exists('role') && $isSelf && $requestedRole !== $userAccount->role) {
                abort(403, 'You cannot change your own role.');
            }

            // Only an administrator may reset somebody else's password, and a
            // user changing their own password must prove they know it.
            if ($replacesPassword) {
                if (! $isSelf) {
                    abort(403, 'Only an administrator can reset another account\'s password.');
                }

                if (! Hash::check((string) ($validated['current_password'] ?? ''), $actor->password)) {
                    abort(422, 'The current password is incorrect.');
                }
            }
        }

        unset($validated['current_password']);

        if (! $replacesPassword) {
            unset($validated['password']);
        }

        $userAccount->update($validated);

        // A forced reset by an administrator must invalidate the target's sessions.
        if ($replacesPassword && ! $isSelf) {
            $userAccount->tokens()->delete();
        }

        // Moving an account away from Active is a lockout, so every existing
        // session has to go with it rather than lasting out the token.
        if (array_key_exists('status', $validated) && $validated['status'] !== 'Active') {
            $userAccount->tokens()->delete();
        }

        return response()->json($userAccount->refresh());
    }

    /**
     * Remove the specified resource from storage.
     */
    public function destroy(UserAccount $userAccount)
    {
        $userAccount->delete();

        return response()->noContent();
    }
}
