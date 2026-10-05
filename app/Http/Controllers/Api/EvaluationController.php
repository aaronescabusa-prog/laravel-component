<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Evaluation;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class EvaluationController extends Controller
{
    /**
     * Display a listing of the resource.
     */
    public function index(Request $request)
    {
        $query = Evaluation::query();

        if ($request->filled('search')) {
            $term = $request->string('search')->toString();
            $query->where(function ($q) use ($term) {
                $q->where('participant', 'like', "%{$term}%")
                    ->orWhere('comment', 'like', "%{$term}%");
            });
        }

        if ($request->filled('event')) {
            $query->where('event', $request->string('event')->toString());
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
        $validated = $request->validate([
            'reference' => ['required', 'string', 'max:50', Rule::unique('evaluations', 'reference')],
            'event' => ['required', 'string', 'max:255'],
            'participant' => ['required', 'string', 'max:255'],
            'rating' => ['required', 'integer', 'min:1', 'max:5'],
            'comment' => ['nullable', 'string'],
            'date' => ['nullable', 'string', 'max:20'],
        ]);

        $evaluation = Evaluation::create($validated);

        return response()->json($evaluation, 201);
    }

    /**
     * Display the specified resource.
     */
    public function show(Evaluation $evaluation)
    {
        return response()->json($evaluation);
    }

    /**
     * Update the specified resource in storage.
     */
    public function update(Request $request, Evaluation $evaluation)
    {
        $validated = $request->validate([
            'reference' => ['sometimes', 'string', 'max:50', Rule::unique('evaluations', 'reference')->ignore($evaluation->id)],
            'event' => ['sometimes', 'required', 'string', 'max:255'],
            'participant' => ['sometimes', 'required', 'string', 'max:255'],
            'rating' => ['sometimes', 'required', 'integer', 'min:1', 'max:5'],
            'comment' => ['nullable', 'string'],
            'date' => ['nullable', 'string', 'max:20'],
        ]);

        $evaluation->update($validated);

        return response()->json($evaluation->refresh());
    }

    /**
     * Remove the specified resource from storage.
     */
    public function destroy(Evaluation $evaluation)
    {
        $evaluation->delete();

        return response()->noContent();
    }
}
