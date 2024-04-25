export async function waitTime(milliseconds: number): Promise<void> {
    await new Promise((resolve, reject) => {
        try {
            setTimeout(resolve, milliseconds);
        } catch (e) {
            reject(e);
        }
    });
}
