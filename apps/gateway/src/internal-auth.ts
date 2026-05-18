export async function computeHmacHex(data: string, secret: string): Promise<string> {
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"]
	);
	const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
	return Array.from(new Uint8Array(sig))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

export async function generateInternalToken(secret: string): Promise<string> {
	const timestamp = Date.now().toString();
	const signatureHex = await computeHmacHex(timestamp, secret);
	return `${timestamp}.${signatureHex}`;
}

export async function internalAuthHeaders(secret: string): Promise<HeadersInit> {
	return {
		Accept: "application/json",
		Authorization: `Bearer ${await generateInternalToken(secret)}`,
	};
}
