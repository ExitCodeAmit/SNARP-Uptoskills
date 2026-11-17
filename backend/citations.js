export function validateCitationInput(body = {}) {
    const citingPaperId = String(body.citingPaperId ?? '');
    const citedPaperId = String(body.citedPaperId ?? '');

    const validId = (value) =>
        /^\d+$/.test(value) &&
        BigInt(value) > 0n &&
        BigInt(value) <= 9223372036854775807n;

    if (!validId(citingPaperId) || !validId(citedPaperId)) {
        throw Object.assign(
            new Error('Select two valid research papers.'),
            { status: 400 }
        );
    }

   if (
    BigInt(citingPaperId) === BigInt(citedPaperId)
    ) {
        throw Object.assign(
            new Error('A paper cannot cite itself.'),
            { status: 400 }
        );
    }

    return { citingPaperId, citedPaperId };
}