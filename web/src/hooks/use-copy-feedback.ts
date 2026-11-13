import { useEffect, useRef, useState } from "react";

/** Copy feedback is shared by deposit fields, token contracts and flow details. */
export function useCopyFeedback() {
	const [copied, setCopied] = useState<string | null>(null);
	const [error, setError] = useState<{ value: string; message: string } | null>(null);
	const timer = useRef<ReturnType<typeof setTimeout>>();
	const request = useRef(0);

	useEffect(() => () => {
		request.current++;
		clearTimeout(timer.current);
	}, []);

	/** Resolves true once the value is on the clipboard, false if the browser refused. */
	async function copy(value: string): Promise<boolean> {
		const current = ++request.current;
		clearTimeout(timer.current);
		setCopied(null);
		setError(null);
		try {
			await navigator.clipboard.writeText(value);
			if (current !== request.current) return true;
			setCopied(value);
			timer.current = setTimeout(() => setCopied(null), 1600);
			return true;
		} catch {
			if (current !== request.current) return false;
			setError({ value, message: "Could not copy. Select the value and copy it manually." });
			return false;
		}
	}

	return { copied, error, copy };
}
