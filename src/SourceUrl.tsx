// External navigation always goes through the native URL policy. There is no
// renderer href or remote resource load, even for malformed publisher metadata.
export default function SourceUrl({ url, open }: { url: string; open: () => void }) {
  return <button type="button" role="link" className="quiet source-url" onClick={open}>{url}</button>;
}
