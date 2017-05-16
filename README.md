<h1>Welcome to ScrambleFace
            </h1>
            <h2>What is it?</h2>
            <p>The server for a cloud-toy patterned after the Scramble Suit from A Scanner Darkly<br/>
                <img src="https://filmfork-cdn.s3.amazonaws.com/content/scramble.gif"></img><br/>
                <a href="http://thedissolve.com/features/movie-of-the-week/823-how-animation-stabilizes-a-scanner-darklys-shiftin/">source</a>
            </p>
            <p>A live deployment of the server is at <a href="http://scrambleface.qvwx.de/index">http://scrambleface.qvwx.de/index</a></p>
            <h2>API</h2>
            <p>The API is simple http decorated with custom headers at a whim. This document when delivered from an active server has living examples, so pattern your usage after it for success.</p>
            <h3>POST for upload</h3>
            <p>The server supports standard multipart-form-data uploads like from this trivially simple form:</p>
            <form>
            </form>
            <h3>GET for download</h3>
            <p>GET-requests can be used to retrieve specific or random images in complete and tiled form.</p>
            <h3>DELETE for remove</h3>
            <p>DELETE-requests remove image from the pool, there is no security on them.</p>